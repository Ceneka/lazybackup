/**
 * Defense-in-depth CSRF check for cookie-authenticated mutations.
 *
 * Browsers send `Sec-Fetch-Site` on modern requests; when present it is the
 * most reliable signal. Older clients only send `Origin` on cross-origin
 * POSTs, so fall back to comparing its host with the host this instance
 * believes it is served on (AUTH_PUBLIC_URL, then X-Forwarded-Host when
 * AUTH_TRUST_PROXY=true, then Host). Requests with neither header are
 * non-browser clients and are allowed through to the normal auth gate.
 *
 * Bearer API tokens are not ambient credentials, so they are exempt.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

export type CsrfDecision =
  | { ok: true }
  | { ok: false; reason: string }

function normalizedHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}

/**
 * Host this instance expects to be reached on. Kept in sync with
 * `webauthnRpFromRequest` (AUTH_PUBLIC_URL → forwarded host → Host).
 */
export function trustedRequestHost(headers: {
  get(name: string): string | null
}): string | null {
  const configured = process.env.AUTH_PUBLIC_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return normalizedHost(url.host)
      }
    } catch {
      // fall through to Host
    }
  }

  if (process.env.AUTH_TRUST_PROXY === 'true') {
    const forwarded = headers.get('x-forwarded-host')?.split(',')[0]
    const host = normalizedHost(forwarded)
    if (host) return host
  }

  return normalizedHost(headers.get('host'))
}

/**
 * Decide whether an unsafe (state-changing) request authenticated by the
 * session cookie may proceed.
 */
export function csrfDecisionForSessionRequest(input: {
  method: string
  headers: { get(name: string): string | null }
}): CsrfDecision {
  if (!isUnsafeMethod(input.method)) return { ok: true }

  const fetchSite = input.headers.get('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') {
      return { ok: true }
    }
    return {
      ok: false,
      reason: 'Cross-site request blocked (Sec-Fetch-Site)',
    }
  }

  const origin = input.headers.get('origin')?.trim()
  if (!origin) {
    // Non-browser client without Origin / Sec-Fetch-Site.
    return { ok: true }
  }

  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return { ok: false, reason: 'Cross-site request blocked (invalid Origin)' }
  }

  const expectedHost = trustedRequestHost(input.headers)
  if (!expectedHost || originHost !== expectedHost) {
    return {
      ok: false,
      reason: 'Cross-site request blocked (Origin does not match Host)',
    }
  }

  return { ok: true }
}
