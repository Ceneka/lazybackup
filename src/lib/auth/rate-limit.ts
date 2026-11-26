import { createHash } from 'crypto'
import { SESSION_COOKIE_NAME, parseCookieValue } from './session'

type Bucket = {
  failures: number
  lastAt: number
  blockedUntil: number
}

const buckets = new Map<string, Bucket>()

const WINDOW_MS = 15 * 60 * 1000
const MAX_BLOCK_MS = 60_000
const FAIL_THRESHOLD = 5
const MAX_BUCKETS = 4096

function prune(now: number) {
  if (buckets.size === 0) return
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastAt > WINDOW_MS) {
      buckets.delete(key)
    }
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest === undefined) break
    buckets.delete(oldest)
  }
}

/** Per-IP when AUTH_TRUST_PROXY=true; otherwise one bucket for the instance. */
export function clientKeyFromRequest(request: { headers: Headers }): string {
  if (process.env.AUTH_TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
    const realIp = request.headers.get('x-real-ip')?.trim()
    if (realIp) return realIp
  }
  return 'instance'
}

export function rateLimitKey(scope: string, clientKey: string): string {
  return `${scope}:${clientKey}`
}

/** Stable, non-reversible suffix for the current session cookie. */
export function sessionKeyFromCookieHeader(
  cookieHeader: string | null | undefined
): string {
  const token = parseCookieValue(cookieHeader ?? null, SESSION_COOKIE_NAME)
  if (!token) return 'no-session'
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/** Keyed per browser session and (when trusted) per client IP. */
export function clientKeyFromSessionOrRequest(
  request: { headers: Headers },
  cookieHeader: string | null | undefined
): string {
  return `${sessionKeyFromCookieHeader(cookieHeader)}:${clientKeyFromRequest(request)}`
}

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterSec: number }

export function assertNotRateLimited(key: string): RateLimitDecision {
  const now = Date.now()
  prune(now)
  const bucket = buckets.get(key)
  if (!bucket) return { ok: true }
  if (now - bucket.lastAt > WINDOW_MS) {
    buckets.delete(key)
    return { ok: true }
  }
  if (bucket.blockedUntil > now) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    }
  }
  return { ok: true }
}

export function recordAuthFailure(key: string): void {
  const now = Date.now()
  prune(now)
  const bucket = buckets.get(key) ?? {
    failures: 0,
    lastAt: now,
    blockedUntil: 0,
  }
  if (now - bucket.lastAt > WINDOW_MS) {
    bucket.failures = 0
    bucket.blockedUntil = 0
  }
  bucket.failures += 1
  bucket.lastAt = now
  if (bucket.failures >= FAIL_THRESHOLD) {
    const exp = Math.min(bucket.failures - FAIL_THRESHOLD, 6)
    const blockMs = Math.min(MAX_BLOCK_MS, 1000 * 2 ** exp)
    bucket.blockedUntil = now + blockMs
  }
  buckets.set(key, bucket)
}

export function recordAuthSuccess(key: string): void {
  buckets.delete(key)
}

export function resetRateLimitForTests(): void {
  buckets.clear()
}
