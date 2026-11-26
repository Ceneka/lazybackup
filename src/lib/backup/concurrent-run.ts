import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_STALE_RUNNING_MS,
  type RunningHistoryLike,
} from './stale-running';
import { RestoreConflictError } from './restore-errors';

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
 * Also refuses while a restore of the same config is in flight (in-process registry).
 */
export async function assertCanStartBackup(configId: string): Promise<void> {
  const activeRestore = findActiveRestoreEntry([...activeRestores.values()], configId);
  if (activeRestore) {
    throw new RestoreRunningForBackupError(activeRestore.historyId);
  }

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

/**
 * Serialize the check-then-insert window for one config: two simultaneous
 * "run backup" requests otherwise both pass assertCanStartBackup before either
 * inserts the running history row. The DB check still handles other processes.
 */
export async function withBackupStartLock<T>(
  configId: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = startQueues.get(configId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  startQueues.set(configId, tail);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (startQueues.get(configId) === tail) {
      startQueues.delete(configId);
    }
  }
}

const startQueues = new Map<string, Promise<void>>();

export type ActiveRestore = {
  historyId: string;
  configId: string;
  startedAt: number;
  token: symbol;
};

const activeRestores = new Map<string, ActiveRestore>();

/** Pure helper: an in-flight restore for `configId`, if any. */
export function findActiveRestoreEntry<T extends { configId: string }>(
  entries: readonly T[],
  configId: string
): T | null {
  return entries.find((entry) => entry.configId === configId) ?? null;
}

export class RestoreAlreadyRunningError extends RestoreConflictError {
  readonly historyId: string;

  constructor(historyId: string) {
    super('A restore for this backup is already running');
    this.name = 'RestoreAlreadyRunningError';
    this.historyId = historyId;
  }
}

export class BackupRunningForRestoreError extends RestoreConflictError {
  readonly historyId: string;

  constructor(historyId: string) {
    super(`Cannot restore while a backup of this configuration is running (history ${historyId})`);
    this.name = 'BackupRunningForRestoreError';
    this.historyId = historyId;
  }
}

export class RestoreRunningForBackupError extends RestoreConflictError {
  readonly historyId: string;

  constructor(historyId: string) {
    super(`Cannot start a backup while a restore of this configuration is running (history ${historyId})`);
    this.name = 'RestoreRunningForBackupError';
    this.historyId = historyId;
  }
}

/** Either conflict that should answer "run backup" with HTTP 409. */
export function isBackupStartConflictError(
  error: unknown
): error is BackupAlreadyRunningError | RestoreRunningForBackupError {
  return (
    isBackupAlreadyRunningError(error) || error instanceof RestoreRunningForBackupError
  );
}

/**
 * Reserve a restore slot synchronously (so two requests cannot both pass),
 * then check for a live backup of the same config. Returns the release fn.
 */
export async function beginRestore(options: {
  historyId: string;
  configId: string;
}): Promise<() => void> {
  const { historyId, configId } = options;

  if (activeRestores.has(historyId)) {
    throw new RestoreAlreadyRunningError(historyId);
  }

  const token = Symbol(historyId);
  activeRestores.set(historyId, {
    historyId,
    configId,
    startedAt: Date.now(),
    token,
  });

  try {
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
      throw new BackupRunningForRestoreError(active.id);
    }
  } catch (error) {
    activeRestores.delete(historyId);
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeRestores.get(historyId)?.token === token) {
      activeRestores.delete(historyId);
    }
  };
}

/** Test helper: drop all in-process restore reservations. */
export function resetRestoreLocksForTests(): void {
  activeRestores.clear();
}
