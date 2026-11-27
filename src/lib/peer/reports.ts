import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';

/**
 * Peer status report (C3). LazyBro and full LazyBackup peers POST this to
 * `/api/peers/agent/ping`; the host stores it for the Bro Space UI.
 *
 * `usedBytes` is what OUR backups use on THEIR disk (the opposite of the
 * peer row's `usedBytes`, which is what they store on this host).
 */
export type PeerStatusReport = {
  usedBytes?: number;
  quotaBytes?: number;
  pendingPulls?: number;
  pendingRecalls?: number;
  lastSyncAt?: Date;
  lastError?: string | null;
  appVersion?: string | null;
};

export const REMOTE_LAST_ERROR_MAX = 500;

export function truncatePeerError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.length > REMOTE_LAST_ERROR_MAX
    ? message.slice(0, REMOTE_LAST_ERROR_MAX)
    : message;
}

/** Persist a peer report and refresh soft presence in one write. */
export async function recordPeerReport(
  peerId: string,
  report: PeerStatusReport,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(peers)
    .set({
      ...(report.usedBytes !== undefined ? { remoteUsedBytes: report.usedBytes } : {}),
      ...(report.quotaBytes !== undefined ? { remoteQuotaBytes: report.quotaBytes } : {}),
      ...(report.lastError !== undefined
        ? { remoteLastError: truncatePeerError(report.lastError) }
        : {}),
      ...(report.lastSyncAt !== undefined ? { remoteLastSyncAt: report.lastSyncAt } : {}),
      ...(report.appVersion !== undefined ? { remoteAppVersion: report.appVersion } : {}),
      remoteReportedAt: now,
      lastSeenAt: now,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(peers.id, peerId));
}
