/** Default: treat "running" older than 6 hours as abandoned (crash / restart). */
export const DEFAULT_STALE_RUNNING_MS = 6 * 60 * 60 * 1000;

export type RunningHistoryLike = {
  id: string;
  status: string;
  startTime: Date | string | number;
};

function toMillis(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') {
    // unix seconds vs ms
    return value < 1e12 ? value * 1000 : value;
  }
  return new Date(value).getTime();
}

/**
 * Pick history ids stuck in `running` longer than maxAgeMs.
 */
export function selectStaleRunningIds(
  entries: readonly RunningHistoryLike[],
  now: Date = new Date(),
  maxAgeMs: number = DEFAULT_STALE_RUNNING_MS
): string[] {
  const cutoff = now.getTime() - maxAgeMs;
  return entries
    .filter((entry) => entry.status === 'running' && toMillis(entry.startTime) < cutoff)
    .map((entry) => entry.id);
}

export function staleRunningErrorMessage(startedAt: Date | string | number): string {
  const started = new Date(toMillis(startedAt)).toISOString();
  return `Marked failed: backup was still running since ${started} after process restart or timeout`;
}
