/**
 * JSON-only guard for unauthenticated state-changing routes.
 *
 * Cross-site HTML forms (and `fetch(..., { mode: 'no-cors' })`) can only send
 * `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`.
 * Next's `request.json()` parses the body regardless of Content-Type, so a
 * malicious page could POST `{"password":"…"}` as text/plain to the public
 * first-run setup endpoint without a CORS preflight.
 *
 * Requiring `application/json` forces a CORS preflight for cross-origin
 * callers, which the auth middleware denies (no CORS headers).
 */
export function hasJsonContentType(headers: {
  get(name: string): string | null
}): boolean {
  const raw = headers.get('content-type') ?? ''
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

/** True when the request advertises a body (does not read it). */
export function hasRequestBody(headers: {
  get(name: string): string | null
}): boolean {
  const length = headers.get('content-length')?.trim()
  if (length && length !== '0') return true
  return Boolean(headers.get('transfer-encoding')?.trim())
}

/**
 * JSON-only rule for API mutations: unsafe methods on `/api/*` (and `/mcp`)
 * that carry a body must declare `application/json`. Bodyless calls such as
 * `POST /api/backups/:id/run` or `DELETE /api/…` stay allowed.
 */
export function requiresJsonMutationContentType(
  method: string,
  pathname: string,
  headers: { get(name: string): string | null }
): boolean {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  const isApi = pathname.startsWith('/api/')
  const isMcp = pathname === '/mcp' || pathname.startsWith('/mcp/')
  if (!isApi && !isMcp) return false
  return hasRequestBody(headers)
}
