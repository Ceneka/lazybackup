import { db } from '@/lib/db';
import { backupConfigs, backupHistory } from '@/lib/db/schema';
import { emitBackupEvent } from '@/lib/events/backup-events';
import {
  clearPendingForArtifact,
  reconcileDeliveryAfterSuccess,
} from '@/lib/backup/mailbox-reconcile';
import { eq } from 'drizzle-orm';
import { parsePeerArtifactPath } from '@/lib/peer/delivery-state';
import { buildRestoreSnapshot } from './restore-snapshot';

/** Stored log cap: keeps SQLite rows small; the tail has the failure text. */
export const LOG_OUTPUT_MAX_CHARS = 512 * 1024;

/**
 * Cap a log before it is written to `backup_history.log_output`.
 *
 * Keeps the LAST 512K characters (errors are at the end) and prefixes a
 * marker with how many characters were dropped. Smaller logs are untouched.
 */
export function capLogOutput(logOutput?: string | null): string | null | undefined {
  if (logOutput == null || logOutput.length <= LOG_OUTPUT_MAX_CHARS) {
    return logOutput;
  }
  const truncated = logOutput.length - LOG_OUTPUT_MAX_CHARS;
  let tail = logOutput.slice(-LOG_OUTPUT_MAX_CHARS);
  // Do not start the stored tail in the middle of a surrogate pair.
  const first = tail.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) {
    tail = tail.slice(1);
  }
  return `…[truncated ${truncated} characters]\n${tail}`;
}

async function backupNameForConfig(configId: string): Promise<string> {
  const row = await db.query.backupConfigs.findFirst({
    where: eq(backupConfigs.id, configId),
    columns: { name: true },
  });
  return row?.name || 'Backup';
}

function emitStarted(options: { historyId: string; configId: string; backupName: string }) {
  emitBackupEvent({
    type: 'backup.started',
    historyId: options.historyId,
    configId: options.configId,
    backupName: options.backupName,
    status: 'running',
    at: new Date().toISOString(),
  });
}

function emitFinished(options: {
  historyId: string;
  configId: string;
  backupName: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  mailboxPending?: boolean;
}) {
  emitBackupEvent({
    type: 'backup.finished',
    historyId: options.historyId,
    configId: options.configId,
    backupName: options.backupName,
    status: options.status,
    errorMessage: options.errorMessage,
    mailboxPending: options.mailboxPending,
    at: new Date().toISOString(),
  });
}

/**
 * Create a new backup history entry for a started backup
 */
export async function createBackupHistoryEntry(
  configId: string,
  options?: { backupName?: string }
) {
  const id = crypto.randomUUID();
  const config = await db.query.backupConfigs.findFirst({
    where: eq(backupConfigs.id, configId),
  });
  if (!config) {
    throw new Error(`Backup configuration with ID ${configId} not found`);
  }
  const backupName = options?.backupName ?? config.name ?? 'Backup';
  // Freeze the restore-relevant config now: later edits must not redirect
  // restores of this run. Legacy rows keep configSnapshot null (live config).
  const configSnapshot = JSON.stringify(buildRestoreSnapshot(config));

  const newEntry = await db
    .insert(backupHistory)
    .values({
      id,
      configId,
      startTime: new Date(),
      status: 'running',
      configSnapshot,
    })
    .returning();

  emitStarted({ historyId: id, configId, backupName });

  return newEntry[0];
}

function fireSuccessPing(historyId: string, configId?: string | null) {
  void import('@/lib/notify/success-ping')
    .then(({ notifyBackupSuccess }) =>
      notifyBackupSuccess({
        historyId,
        configId: configId ?? undefined,
      })
    )
    .catch((notifyError) => {
      console.error('Success ping notify error:', notifyError);
    });
}

/**
 * Update a backup history entry with success status
 */
export async function updateBackupHistorySuccess(
  historyId: string,
  stats: {
    fileCount?: number;
    totalSize?: number;
    transferredSize?: number;
    logOutput?: string;
    artifactPath?: string;
    artifactSha256?: string | null;
    mailboxPending?: boolean;
  }
) {
  const {
    fileCount,
    totalSize,
    transferredSize,
    logOutput,
    artifactPath,
    artifactSha256,
    mailboxPending,
  } = stats;
  
  // Update the history entry with success status and stats
  const updatedEntry = await db.update(backupHistory)
    .set({
      endTime: new Date(),
      status: 'success',
      fileCount,
      totalSize,
      transferredSize,
      logOutput: capLogOutput(logOutput),
      // A fresh success is not a delivery failure; drop any stale reason.
      deliveryError: null,
      ...(artifactPath !== undefined ? { artifactPath } : {}),
      ...(artifactSha256 !== undefined ? { artifactSha256 } : {}),
      ...(mailboxPending !== undefined ? { mailboxPending } : {}),
    })
    .where(eq(backupHistory.id, historyId))
    .returning();

  // Mailbox staging is not off-host yet — ping when the bro ACK verifies.
  // The helper also resolves the race where the ACK lands before this row.
  const effectivePending = await reconcileDeliveryAfterSuccess({
    executor: db,
    historyId,
    configId: updatedEntry[0]?.configId,
    artifactPath: updatedEntry[0]?.artifactPath,
    mailboxPending,
    notifyDelivered: fireSuccessPing,
  });

  const configId = updatedEntry[0]?.configId;
  if (configId) {
    const backupName = await backupNameForConfig(configId);
    emitFinished({
      historyId,
      configId,
      backupName,
      status: 'success',
      mailboxPending: effectivePending,
    });
  }

  return updatedEntry[0];
}

/**
 * Persist (or clear) the Bro delivery failure reason for a mailbox artifact.
 *
 * Every failure/success site writes through here so the history APIs can trust
 * the column and only fall back to the peer report for legacy rows. A non-peer
 * path cannot be delivered off-host, so it is a no-op.
 */
export async function setDeliveryErrorForArtifact(
  artifactPath: string,
  message: string | null,
  executor: Pick<typeof db, 'update'> = db
): Promise<number> {
  const ref = parsePeerArtifactPath(artifactPath);
  if (!ref) return 0;
  const updated = await executor
    .update(backupHistory)
    .set({ deliveryError: message })
    .where(eq(backupHistory.artifactPath, artifactPath))
    .returning({ id: backupHistory.id });
  return updated.length;
}

/** Bro verified it stored the staged object; clear pending flag and fire success ping. */
export async function clearMailboxPendingForArtifact(artifactPath: string) {
  // Atomic conditional update: an ACK that races the success-write race check
  // clears the row once and only the winner fires the ping.
  await clearPendingForArtifact({
    executor: db,
    artifactPath,
    notifyDelivered: fireSuccessPing,
  });
  // Verified delivery wins: a previous failure reason is stale now.
  await setDeliveryErrorForArtifact(artifactPath, null);
}

/**
 * Reason for a `failed` Bro delivery. Prefers the persisted `delivery_error`;
 * legacy rows (and failures recorded only on the peer) fall back to the peer
 * report that names this object. Stored/waiting rows never carry an error.
 */
export function deliveryErrorForHistoryRow(
  row: {
    deliveryError?: string | null;
    artifactPath?: string | null;
    backupConfig?: {
      destinationPeer?: { remoteLastError?: string | null } | null;
    } | null;
  },
  deliveryState: string | null
): string | null {
  if (deliveryState !== 'failed') return null;
  const persisted = row.deliveryError?.trim();
  if (persisted) return persisted;
  const remote = row.backupConfig?.destinationPeer?.remoteLastError?.trim();
  if (!remote) return null;
  const ref = parsePeerArtifactPath(row.artifactPath);
  // Only a report that names this object is about this run (same rule
  // `deliveryStateForHistoryRow` uses to mark it failed).
  return ref && remote.includes(ref.objectKey) ? remote : null;
}

/**
 * Update a backup history entry with failed status
 */
export async function updateBackupHistoryFailure(
  historyId: string,
  error: Error | string,
  options?: { logOutput?: string; configId?: string; backupName?: string }
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Update the history entry with failure status
  const updatedEntry = await db.update(backupHistory)
    .set({
      endTime: new Date(),
      status: 'failed',
      errorMessage,
      // A failed run is not waiting for an ACK anymore; a late ACK must not
      // fire a success ping for it.
      mailboxPending: false,
      ...(options?.logOutput
        ? { logOutput: capLogOutput(options.logOutput) }
        : {}),
    })
    .where(eq(backupHistory.id, historyId))
    .returning();

  // Fire-and-forget: never block or fail the backup outcome on webhook errors
  void import('@/lib/notify/failure-webhook')
    .then(({ notifyBackupFailure }) =>
      notifyBackupFailure({
        historyId,
        errorMessage,
        configId: options?.configId ?? updatedEntry[0]?.configId,
        backupName: options?.backupName,
      })
    )
    .catch((notifyError) => {
      console.error('Failure webhook notify error:', notifyError);
    });

  const configId = options?.configId ?? updatedEntry[0]?.configId;
  if (configId) {
    const backupName = options?.backupName ?? (await backupNameForConfig(configId));
    emitFinished({
      historyId,
      configId,
      backupName,
      status: 'failed',
      errorMessage,
    });
  }

  return updatedEntry[0];
} 
