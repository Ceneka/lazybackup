import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Create a new backup history entry for a started backup
 */
export async function createBackupHistoryEntry(configId: string) {
  const id = crypto.randomUUID();
  
  // Create a new history entry with 'running' status
  const newEntry = await db.insert(backupHistory)
    .values({
      id,
      configId,
      startTime: new Date(),
      status: 'running',
    })
    .returning();
  
  return newEntry[0];
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
  if (!mailboxPending) {
    void import('@/lib/notify/success-ping')
      .then(({ notifyBackupSuccess }) =>
        notifyBackupSuccess({
          historyId,
          configId: updatedEntry[0]?.configId,
        })
      )
      .catch((notifyError) => {
        console.error('Success ping notify error:', notifyError);
      });
  }
  
  return updatedEntry[0];
}

/** Bro verified it stored the staged object; clear pending flag and fire success ping. */
export async function clearMailboxPendingForArtifact(artifactPath: string) {
  const pending = await db.query.backupHistory.findMany({
    where: and(
      eq(backupHistory.artifactPath, artifactPath),
      eq(backupHistory.mailboxPending, true)
    ),
  });
  if (pending.length === 0) return;

  await db
    .update(backupHistory)
    .set({ mailboxPending: false })
    .where(
      and(
        eq(backupHistory.artifactPath, artifactPath),
        eq(backupHistory.mailboxPending, true)
      )
    );

  for (const row of pending) {
    void import('@/lib/notify/success-ping')
      .then(({ notifyBackupSuccess }) =>
        notifyBackupSuccess({
          historyId: row.id,
          configId: row.configId,
        })
      )
      .catch((notifyError) => {
        console.error('Success ping notify error:', notifyError);
      });
  }
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
  
  return updatedEntry[0];
} 
