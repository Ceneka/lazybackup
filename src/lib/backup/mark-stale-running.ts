import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_STALE_RUNNING_MS,
  selectStaleRunningIds,
  staleRunningErrorMessage,
} from './stale-running';

/**
 * Mark abandoned `running` history rows as failed (e.g. after app restart).
 * Returns how many rows were updated.
 */
export async function markStaleRunningBackups(
  options: { maxAgeMs?: number; now?: Date } = {}
): Promise<number> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_STALE_RUNNING_MS;
  const now = options.now ?? new Date();

  const running = await db.query.backupHistory.findMany({
    where: eq(backupHistory.status, 'running'),
    columns: {
      id: true,
      status: true,
      startTime: true,
    },
  });

  const staleIds = selectStaleRunningIds(running, now, maxAgeMs);
  if (staleIds.length === 0) {
    return 0;
  }

  const byId = new Map(running.map((row) => [row.id, row]));

  for (const id of staleIds) {
    const row = byId.get(id);
    await db
      .update(backupHistory)
      .set({
        status: 'failed',
        endTime: now,
        errorMessage: staleRunningErrorMessage(row?.startTime ?? now),
      })
      .where(eq(backupHistory.id, id));
  }

  return staleIds.length;
}
