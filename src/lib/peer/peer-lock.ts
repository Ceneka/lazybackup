import { PeerUploadLimitError } from './upload-limit';

/** Default number of in-flight + queued callers allowed per peer. */
export const PEER_LOCK_QUEUE_MAX_DEFAULT = 8;

/**
 * Waiting writes are rejected with this instead of queueing without bound.
 * Extends PeerUploadLimitError so peer routes (publicUploadErrorMessage) keep
 * the 429 status and the message instead of turning it into a generic 400.
 */
export class PeerLockQueueFullError extends PeerUploadLimitError {
  constructor(peerId: string, max: number) {
    super(`Peer ${peerId} is busy: queue is full (max ${max}); retry shortly`, 429);
    this.name = 'PeerLockQueueFullError';
  }
}

type PeerLockState = {
  tail: Promise<unknown>;
  pending: number;
};

const states = new Map<string, PeerLockState>();

/** Reject non-positive / non-numeric values so a typo cannot disable the bound. */
export function peerLockQueueMax(): number {
  const raw = process.env.PEER_LOCK_QUEUE_MAX;
  if (raw == null || raw.trim() === '') return PEER_LOCK_QUEUE_MAX_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return PEER_LOCK_QUEUE_MAX_DEFAULT;
  return parsed;
}

/**
 * Serialize async work per peer so quota check + write cannot race.
 * At most `PEER_LOCK_QUEUE_MAX` callers (one running + the rest queued) are
 * accepted per peer; the next one fails fast with a 429-style error. FIFO.
 */
export function withPeerLock<T>(peerId: string, fn: () => Promise<T>): Promise<T> {
  const max = peerLockQueueMax();
  let state = states.get(peerId);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 };
    states.set(peerId, state);
  }
  if (state.pending >= max) {
    return Promise.reject(new PeerLockQueueFullError(peerId, max));
  }

  const current = state;
  current.pending += 1;

  const next = current.tail.then(fn, fn);
  current.tail = next.then(
    () => undefined,
    () => undefined
  );

  return next.then(
    (value) => {
      release(peerId, current);
      return value;
    },
    (error) => {
      release(peerId, current);
      throw error;
    }
  );
}

function release(peerId: string, state: PeerLockState): void {
  state.pending -= 1;
  if (state.pending === 0 && states.get(peerId) === state) {
    states.delete(peerId);
  }
}
