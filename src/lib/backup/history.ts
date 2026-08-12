import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
  }
) {
  const { fileCount, totalSize, transferredSize, logOutput, artifactPath } = stats;
  
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
    })
    .where(eq(backupHistory.id, historyId))
    .returning();

  // Fire-and-forget: never block or fail the backup outcome on ping errors
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
  
  return updatedEntry[0];
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

/**
 * Get recent backup history for a specific config
 */
export async function getRecentBackupHistory(configId: string, limit = 5) {
  const history = await db.query.backupHistory.findMany({
    where: eq(backupHistory.configId, configId),
    orderBy: [backupHistory.startTime],
    limit,
  });
  
  return history;
}

/**
 * Get the most recent backup for a specific config
 */
export async function getLatestBackup(configId: string) {
  const history = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.configId, configId),
    orderBy: [backupHistory.startTime],
  });
  
  return history;
}

/**
 * Calculate backup success rate for a specific config
 */
export async function getBackupSuccessRate(configId: string) {
  const history = await db.query.backupHistory.findMany({
    where: eq(backupHistory.configId, configId),
    columns: {
      status: true,
    },
  });
  
  if (history.length === 0) {
    return 100; // No backups yet, return perfect rate
  }
  
  const successCount = history.filter(entry => entry.status === 'success').length;
  return Math.round((successCount / history.length) * 100);
} 
