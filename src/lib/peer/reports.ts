import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { backupHistory, peers } from '@/lib/db/schema';
import { setDeliveryErrorForArtifact } from '@/lib/backup/history';
import { parsePeerArtifactPath } from './delivery-state';

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

/**
 * Persist a peer's delivery failure on the history run that owns the artifact
 * it names, using the same object-key match as the read-side fallback.
 *
 * `lastError === null` means the friend's sync pass was clean, so every
 * persisted reason for this peer is stale and cleared. Errors that name none of
 * our objects (transport/offline) are not delivery failures and change nothing.
 */
export async function syncDeliveryErrorsFromReport(
  peerId: string,
  lastError: string | null,
  executor: Pick<typeof db, 'select' | 'update'> = db
): Promise<number> {
  const prefix = `peer://${peerId}/`;
  const ownedByPeer = sql`substr(${backupHistory.artifactPath}, 1, ${prefix.length}) = ${prefix}`;
  const rows = await executor
    .select({
      artifactPath: backupHistory.artifactPath,
      deliveryError: backupHistory.deliveryError,
    })
    .from(backupHistory)
    .where(
      lastError === null
        ? and(ownedByPeer, isNotNull(backupHistory.deliveryError))
        : ownedByPeer
    );

  const pendingWrites = new Set<string>();
  for (const row of rows) {
    const artifactPath = row.artifactPath;
    if (!artifactPath) continue;
    if (lastError === null) {
      pendingWrites.add(artifactPath);
      continue;
    }
    // Re-writing the same reason on every 45s report would churn SQLite.
    if (row.deliveryError === lastError) continue;
    const ref = parsePeerArtifactPath(artifactPath);
    if (ref && lastError.includes(ref.objectKey)) pendingWrites.add(artifactPath);
  }

  let updated = 0;
  for (const artifactPath of pendingWrites) {
    updated += await setDeliveryErrorForArtifact(artifactPath, lastError, executor);
  }
  return updated;
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

  // The report is the authoritative failure signal; persist it now so a later
  // report (or an unrelated error) cannot erase the reason history shows.
  if (report.lastError !== undefined) {
    await syncDeliveryErrorsFromReport(peerId, truncatePeerError(report.lastError));
  }
}
