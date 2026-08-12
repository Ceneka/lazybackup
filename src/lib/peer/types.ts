import type { peers } from '@/lib/db/schema';

export type PeerRow = typeof peers.$inferSelect;

export type PeerPublic = {
  id: string;
  name: string;
  remoteBaseUrl: string;
  remotePeerId: string | null;
  quotaBytes: number;
  usedBytes: number;
  status: string;
  inboundTokenPrefix: string;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function redactPeer(peer: PeerRow): PeerPublic {
  return {
    id: peer.id,
    name: peer.name,
    remoteBaseUrl: peer.remoteBaseUrl,
    remotePeerId: peer.remotePeerId,
    quotaBytes: peer.quotaBytes,
    usedBytes: peer.usedBytes,
    status: peer.status,
    inboundTokenPrefix: peer.inboundTokenPrefix,
    lastActivityAt: peer.lastActivityAt,
    createdAt: peer.createdAt,
    updatedAt: peer.updatedAt,
  };
}

export const INSTANCE_BASE_URL_KEY = 'instanceBaseUrl';
export const PEER_TOKEN_PREFIX = 'lbpeer_';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}

export function bytesToGb(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}
