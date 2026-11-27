import { and, eq } from 'drizzle-orm';
import type { db as appDb } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { parsePeerArtifactPath } from '@/lib/peer/delivery-state';
import { stagedObjectExists } from '@/lib/peer/staging';

/**
 * Mailbox delivery reconciliation (C4 + success-ping timing).
 *
 * A peer backup is written as `success` while the artifact is only staged for
 * the friend. Delivery is confirmed when the ACK clears `mailboxPending`.
 * These helpers own the two race-sensitive spots:
 * - ACK after the success row exists -> clear by artifact path, ping once.
 * - ACK before the success row exists -> the staged file is already gone, so
 *   the success write reconciles immediately, ping once.
 *
 * Executor + notifier are injected so the race is unit-testable without
 * mocking the global database module.
 */

export type HistoryWriter = Pick<typeof appDb, 'update'>;
export type DeliveredNotifier = (
  historyId: string,
  configId?: string | null
) => void;

type Row = { id: string; configId: string | null };

async function clearById(
  executor: HistoryWriter,
  historyId: string,
  notifyDelivered: DeliveredNotifier
): Promise<Row[]> {
  const cleared = await executor
    .update(backupHistory)
    .set({ mailboxPending: false })
    .where(and(eq(backupHistory.id, historyId), eq(backupHistory.mailboxPending, true)))
    .returning({ id: backupHistory.id, configId: backupHistory.configId });
  for (const row of cleared) notifyDelivered(row.id, row.configId);
  return cleared;
}

/**
 * Decide whether a just-written success row is still waiting for the friend.
 * Returns the effective `mailboxPending` value.
 */
export async function reconcileDeliveryAfterSuccess(options: {
  executor: HistoryWriter;
  historyId: string;
  configId?: string | null;
  artifactPath?: string | null;
  mailboxPending?: boolean;
  notifyDelivered: DeliveredNotifier;
  stagedExists?: (peerId: string, objectKey: string) => Promise<boolean>;
}): Promise<boolean> {
  const {
    executor,
    historyId,
    configId,
    artifactPath,
    mailboxPending,
    notifyDelivered,
  } = options;

  if (!mailboxPending) {
    notifyDelivered(historyId, configId);
    return false;
  }

  const ref = parsePeerArtifactPath(artifactPath);
  if (!ref) return true; // Cannot check; leave the pending flag alone.

  const checkStaged = options.stagedExists ?? stagedObjectExists;
  const stillStaged = await checkStaged(ref.peerId, ref.objectKey).catch(() => true);
  if (stillStaged) return true;

  // ACK won the race: the staged file is gone and (probably) a verified ACK
  // already fired before this row existed. Clear + ping from here, once.
  await clearById(executor, historyId, notifyDelivered);
  return false;
}

/**
 * ACK path: clear every pending row for this artifact and ping only rows the
 * conditional update actually flipped (so a concurrent reconciliation cannot
 * double-ping).
 */
export async function clearPendingForArtifact(options: {
  executor: HistoryWriter;
  artifactPath: string;
  notifyDelivered: DeliveredNotifier;
}): Promise<number> {
  const cleared = await options.executor
    .update(backupHistory)
    .set({ mailboxPending: false })
    .where(
      and(
        eq(backupHistory.artifactPath, options.artifactPath),
        eq(backupHistory.mailboxPending, true)
      )
    )
    .returning({ id: backupHistory.id, configId: backupHistory.configId });

  for (const row of cleared) options.notifyDelivered(row.id, row.configId);
  return cleared.length;
}
