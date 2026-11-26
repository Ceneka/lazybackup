import { db } from '@/lib/db';
import { backupConfigs, backupHistory } from '@/lib/db/schema';
import { emitBackupEvent } from '@/lib/events/backup-events';
import {
  clearPendingForArtifact,
  reconcileDeliveryAfterSuccess,
} from '@/lib/backup/mailbox-reconcile';
import { eq } from 'drizzle-orm';

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
  const backupName = options?.backupName ?? (await backupNameForConfig(configId));

  const newEntry = await db
    .insert(backupHistory)
    .values({
      id,
      configId,
      startTime: new Date(),
      status: 'running',
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
      logOutput,
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

/** Bro verified it stored the staged object; clear pending flag and fire success ping. */
export async function clearMailboxPendingForArtifact(artifactPath: string) {
  // Atomic conditional update: an ACK that races the success-write race check
  // clears the row once and only the winner fires the ping.
  await clearPendingForArtifact({
    executor: db,
    artifactPath,
    notifyDelivered: fireSuccessPing,
  });
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
      ...(options?.logOutput ? { logOutput: options.logOutput } : {}),
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
