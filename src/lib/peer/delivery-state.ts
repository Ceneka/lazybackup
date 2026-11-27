/**
 * Truthful delivery state for Bro Space destinations (C4).
 *
 * A peer backup is `success` as soon as the artifact is staged locally, but
 * it is not off-site until the friend pulls it and ACKs. History rows expose
 * that distinction so the UI never reports a waiting backup as delivered.
 */

export type DeliveryState = 'stored' | 'waiting' | 'failed' | null;

export type PeerArtifactRef = { peerId: string; objectKey: string };

/** Parse `peer://<peerId>/<objectKey>` (object keys may contain slashes). */
export function parsePeerArtifactPath(
  artifactPath: string | null | undefined
): PeerArtifactRef | null {
  if (!artifactPath) return null;
  const match = /^peer:\/\/([^/]+)\/(.+)$/.exec(artifactPath);
  if (!match?.[1] || !match[2]) return null;
  return { peerId: match[1], objectKey: match[2] };
}

export function deriveDeliveryState(input: {
  destinationKind?: string | null;
  mailboxPending?: boolean | null;
  artifactPath?: string | null;
  /** Retention / peer removal took the artifact away: no delivery claim. */
  artifactRemoved?: boolean | null;
  /** Peer row for the destination; only the reported error is used. */
  peer?: { remoteLastError?: string | null } | null;
}): DeliveryState {
  if (input.destinationKind !== 'peer') return null;
  if (input.artifactRemoved) return null;
  if (!input.mailboxPending) return 'stored';

  // The peer's last report names the object it failed on (quota exceeded,
  // corrupt/mismatched pull, rejected ACK). Transport errors and "friend is
  // offline" do not name a key, so they stay `waiting` rather than `failed`.
  const ref = parsePeerArtifactPath(input.artifactPath);
  const lastError = input.peer?.remoteLastError ?? null;
  if (ref && lastError && lastError.includes(ref.objectKey)) return 'failed';
  return 'waiting';
}

/** Convenience for history rows with a nested backup config + destination peer. */
export function deliveryStateForHistoryRow(row: {
  mailboxPending?: boolean | null;
  artifactPath?: string | null;
  artifactRemoved?: boolean | null;
  backupConfig?: {
    destinationKind?: string | null;
    destinationPeer?: { remoteLastError?: string | null } | null;
  } | null;
}): DeliveryState {
  return deriveDeliveryState({
    destinationKind: row.backupConfig?.destinationKind,
    mailboxPending: row.mailboxPending,
    artifactPath: row.artifactPath,
    artifactRemoved: row.artifactRemoved,
    peer: row.backupConfig?.destinationPeer,
  });
}
