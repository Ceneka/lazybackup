import type { peers } from '@/lib/db/schema';

export type PeerRow = typeof peers.$inferSelect;

export type PeerPublic = {
  id: string;
  name: string;
  remoteBaseUrl: string;
  remotePeerId: string | null;
  quotaBytes: number;
  usedBytes: number;
  transport: 'mailbox' | 'direct';
  status: string;
  inboundTokenPrefix: string;
  lastSeenAt: Date | null;
  lastActivityAt: Date | null;
  /** lazybro = outbound-only friend app (no remote URL); lazybackup = full peer */
  kind: 'lazybro' | 'lazybackup';
  /** Soft presence: last agent ping within 90 s */
  online: boolean;
  /** Soft: objects waiting in our staging for this peer to pull */
  pendingSyncCount?: number;
  /** Bytes waiting in staging (plus history rows still marked pending) */
  pendingBytes?: number;
  /** Oldest pending object (ISO) */
  oldestPendingAt?: string | null;
  /** What OUR backups use on THEIR disk, as reported by them (C3) */
  remoteUsedBytes: number | null;
  remoteQuotaBytes: number | null;
  remoteLastError: string | null;
  remoteLastSyncAt: Date | null;
  remoteAppVersion: string | null;
  remoteReportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const PEER_ONLINE_WINDOW_MS = 90_000;

export function redactPeer(
  peer: PeerRow,
  extra?: {
    pendingSyncCount?: number;
    pendingBytes?: number;
    oldestPendingAt?: string | null;
  }
): PeerPublic {
  return {
    id: peer.id,
    name: peer.name,
    remoteBaseUrl: peer.remoteBaseUrl,
    remotePeerId: peer.remotePeerId,
    quotaBytes: peer.quotaBytes,
    usedBytes: peer.usedBytes,
    transport: peer.transport === 'direct' ? 'direct' : 'mailbox',
    status: peer.status,
    inboundTokenPrefix: peer.inboundTokenPrefix,
    lastSeenAt: peer.lastSeenAt,
    lastActivityAt: peer.lastActivityAt,
    kind: peer.remoteBaseUrl.trim() ? 'lazybackup' : 'lazybro',
    online:
      peer.status === 'active' &&
      peer.lastSeenAt != null &&
      Date.now() - peer.lastSeenAt.getTime() <= PEER_ONLINE_WINDOW_MS,
    pendingSyncCount: extra?.pendingSyncCount,
    pendingBytes: extra?.pendingBytes,
    oldestPendingAt: extra?.oldestPendingAt ?? null,
    remoteUsedBytes: peer.remoteUsedBytes ?? null,
    remoteQuotaBytes: peer.remoteQuotaBytes ?? null,
    remoteLastError: peer.remoteLastError ?? null,
    remoteLastSyncAt: peer.remoteLastSyncAt ?? null,
    remoteAppVersion: peer.remoteAppVersion ?? null,
    remoteReportedAt: peer.remoteReportedAt ?? null,
    createdAt: peer.createdAt,
    updatedAt: peer.updatedAt,
  };
}

export const INSTANCE_BASE_URL_KEY = 'instanceBaseUrl';
export const PEER_TOKEN_PREFIX = 'lbpeer_';

export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}

export function bytesToGb(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}
