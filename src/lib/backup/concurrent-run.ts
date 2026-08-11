import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_STALE_RUNNING_MS,
  type RunningHistoryLike,
} from './stale-running';

function toMillis(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }
  return new Date(value).getTime();
}

/**
 * Among running history rows, return the freshest non-stale one (if any).
 * Stale "running" rows do not block a new start (same cutoff as mark-stale-running).
 */
export function findActiveRunningEntry(
  entries: readonly RunningHistoryLike[],
  now: Date = new Date(),
  maxAgeMs: number = DEFAULT_STALE_RUNNING_MS
): RunningHistoryLike | null {
  const cutoff = now.getTime() - maxAgeMs;
  let best: RunningHistoryLike | null = null;
  let bestMs = -1;

  for (const entry of entries) {
    if (entry.status !== 'running') continue;
    const started = toMillis(entry.startTime);
    if (started < cutoff) continue;
    if (started >= bestMs) {
      best = entry;
      bestMs = started;
    }
  }

  return best;
}

export class BackupAlreadyRunningError extends Error {
  readonly historyId: string;
  readonly startTime: Date | string | number;

  constructor(historyId: string, startTime: Date | string | number) {
    super(`Backup is already running (history ${historyId})`);
    this.name = 'BackupAlreadyRunningError';
    this.historyId = historyId;
    this.startTime = startTime;
  }
}

export function isBackupAlreadyRunningError(
  error: unknown
): error is BackupAlreadyRunningError {
  return error instanceof BackupAlreadyRunningError;
}

/**
 * Throws BackupAlreadyRunningError if this config has a non-stale running history row.
 */
export async function assertCanStartBackup(configId: string): Promise<void> {
  const running = await db.query.backupHistory.findMany({
    where: and(
      eq(backupHistory.configId, configId),
      eq(backupHistory.status, 'running')
    ),
    columns: {
      id: true,
      status: true,
      startTime: true,
    },
  });

  const active = findActiveRunningEntry(running);
  if (active) {
    throw new BackupAlreadyRunningError(active.id, active.startTime);
  }
}
