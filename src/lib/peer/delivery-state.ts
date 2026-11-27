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
  /** Run status; a failed/running run is never "stored" off-site. */
  status?: string | null;
  mailboxPending?: boolean | null;
  artifactPath?: string | null;
  /** Retention / peer removal took the artifact away: no delivery claim. */
  artifactRemoved?: boolean | null;
  /** Persisted failure reason for THIS artifact (outranks the peer's last error). */
  deliveryError?: string | null;
  /** Peer row for the destination; only the reported error is used. */
  peer?: { remoteLastError?: string | null } | null;
}): DeliveryState {
  if (input.destinationKind !== 'peer') return null;
  if (input.artifactRemoved) return null;
  // No peer artifact means nothing was handed to the friend. This also keeps
  // a local run from looking delivered after its config was edited to point at
  // a friend, and a failed/running run from inheriting "stored" from the
  // default `mailbox_pending = 0`.
  const ref = parsePeerArtifactPath(input.artifactPath);
  if (!ref) return null;
  if (input.status && input.status !== 'success') return null;
  if (!input.mailboxPending) return 'stored';

  // A persisted reason is authoritative: a later, unrelated peer error (or a
  // peer that goes quiet) must not hide the failure behind `waiting`.
  if (input.deliveryError?.trim()) return 'failed';

  // The peer's last report names the object it failed on (quota exceeded,
  // corrupt/mismatched pull, rejected ACK). Transport errors and "friend is
  // offline" do not name a key, so they stay `waiting` rather than `failed`.
  const lastError = input.peer?.remoteLastError ?? null;
  if (lastError && lastError.includes(ref.objectKey)) return 'failed';
  return 'waiting';
}

/** Convenience for history rows with a nested backup config + destination peer. */
export function deliveryStateForHistoryRow(row: {
  status?: string | null;
  mailboxPending?: boolean | null;
  artifactPath?: string | null;
  artifactRemoved?: boolean | null;
  deliveryError?: string | null;
  backupConfig?: {
    destinationKind?: string | null;
    destinationPeer?: { remoteLastError?: string | null } | null;
  } | null;
}): DeliveryState {
  // A peer artifact path is authoritative: the live config may have been
  // edited to another destination (or to peer) after this run.
  const destinationKind = parsePeerArtifactPath(row.artifactPath)
    ? 'peer'
    : row.backupConfig?.destinationKind;
  return deriveDeliveryState({
    destinationKind,
    status: row.status,
    mailboxPending: row.mailboxPending,
    artifactPath: row.artifactPath,
    artifactRemoved: row.artifactRemoved,
    deliveryError: row.deliveryError,
    peer: row.backupConfig?.destinationPeer,
  });
}
