const tails = new Map<string, Promise<unknown>>();

/**
 * Serialize async work per peer so quota check + write cannot race.
 */
export function withPeerLock<T>(peerId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(peerId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  tails.set(
    peerId,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}
