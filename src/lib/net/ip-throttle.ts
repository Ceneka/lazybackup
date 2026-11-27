type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX = 10;
/** Keep the in-memory map from growing without bound under spoofed keys. */
const PRUNE_THRESHOLD = 5_000;
const MAX_BUCKETS = 10_000;

/** Full expiry sweeps are O(n); run at most once per second of (logical) time. */
const SWEEP_INTERVAL_MS = 1_000;
let lastSweepAt = Number.NEGATIVE_INFINITY;

function pruneExpired(now: number): void {
  if (buckets.size < PRUNE_THRESHOLD) return;
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }
  // Spoofed keys can all be live inside one window; evict the oldest so
  // memory stays bounded. Rate limiting is best-effort, not an auth boundary.
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

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
  pruneExpired(now);
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
  lastSweepAt = Number.NEGATIVE_INFINITY;
}

/** Test-only visibility into map size (unbounded-map regression). */
export function ipRateLimitBucketCountForTests(): number {
  return buckets.size;
}
