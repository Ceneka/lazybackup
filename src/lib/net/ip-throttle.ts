type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX = 10;

/**
 * In-memory per-key throttle. Returns true if the attempt is allowed.
 * Used for public pairing POSTs (not a substitute for auth).
 */
export function consumeIpRateLimit(
  key: string,
  options?: { windowMs?: number; max?: number; now?: number }
): boolean {
  const now = options?.now ?? Date.now();
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options?.max ?? DEFAULT_MAX;
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function resetIpRateLimitForTests(): void {
  buckets.clear();
}
