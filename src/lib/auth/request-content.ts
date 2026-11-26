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
