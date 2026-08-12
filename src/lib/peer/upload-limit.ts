/**
 * Peer upload size gates: require Content-Length, enforce a hard cap, and
 * never read a body larger than the declared / allowed size.
 */

/** Absolute ceiling for a single peer store/recall body (32 GiB). */
export const PEER_UPLOAD_HARD_CAP_BYTES = 32 * 1024 * 1024 * 1024;

export class PeerUploadLimitError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PeerUploadLimitError';
    this.status = status;
  }
}

export function parseContentLengthHeader(header: string | null | undefined): number | null {
  if (header == null) return null;
  const raw = header.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export function maxAllowedPeerUploadBytes(quotaBytes: number): number {
  const quota = Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : 0;
  return Math.min(PEER_UPLOAD_HARD_CAP_BYTES, quota);
}

/**
 * Validate Content-Length before buffering. Returns the declared size.
 */
export function assertDeclaredUploadSize(options: {
  contentLengthHeader: string | null | undefined;
  quotaBytes: number;
  /** When replacing an existing object, quota is checked against net additional bytes later. */
  hardCapBytes?: number;
}): number {
  const declared = parseContentLengthHeader(options.contentLengthHeader);
  if (declared == null) {
    throw new PeerUploadLimitError('Content-Length header is required', 411);
  }
  const hardCap = options.hardCapBytes ?? PEER_UPLOAD_HARD_CAP_BYTES;
  if (declared > hardCap) {
    throw new PeerUploadLimitError(
      `Upload exceeds hard cap of ${hardCap} bytes`,
      413
    );
  }
  const quotaCap = maxAllowedPeerUploadBytes(options.quotaBytes);
  if (declared > quotaCap) {
    throw new PeerUploadLimitError(
      `Upload exceeds peer quota cap of ${quotaCap} bytes`,
      413
    );
  }
  return declared;
}
