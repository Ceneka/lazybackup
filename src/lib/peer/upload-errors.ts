import { PeerUploadLimitError } from './upload-limit';

/**
 * Peer upload handlers previously returned raw fs error messages, leaking
 * server paths (storage root, temp dirs) to the remote peer. Keep the useful
 * quota/size/digest messages, hide everything else behind a generic error.
 */
export function publicUploadErrorMessage(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof PeerUploadLimitError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : '';
  const safe =
    /quota exceeded/i.test(message) ||
    /^Invalid object key$/.test(message) ||
    /^Recall not found$/.test(message) ||
    /^Recall is (expired|not ready|consumed|failed)/i.test(message) ||
    /^Content-Length mismatch/i.test(message) ||
    /SHA-256 mismatch/i.test(message) ||
    /^Empty body$/.test(message);
  return { status: 400, message: safe ? message : 'Upload failed' };
}
