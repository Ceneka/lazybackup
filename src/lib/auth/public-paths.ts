/**
 * Public-path predicate for the auth middleware.
 *
 * Kept in its own module (no Next.js imports) so the exactness of the public
 * list can be unit-tested.
 *
 * Public:
 *  - login page + endpoints that authenticate inside the route
 *  - health, auth status/login/setup, passkey login
 *  - peer store / mailbox agent API (lbpeer_ Bearer verified in the route)
 *  - Next static bundles and top-level files served from `public/`
 *    (logo.svg, apple-touch-icon.png, favicon.ico, …)
 *
 * Everything else — every other page, `/api/*` and `/mcp` — must pass the
 * session / API-token gate.
 */

const PUBLIC_EXACT = new Set([
  '/login',
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/webauthn/login',
  '/api/peers/pair',
  '/manifest.webmanifest',
])

/** Top-level files served from `public/` (never nested app/API routes). */
const TOP_LEVEL_ASSET = /^\/[^/]+\.(?:ico|png|svg|jpg|jpeg|gif|webp|txt|xml)$/i

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true

  // Peer opaque store + mailbox agent API authenticate with lbpeer_ Bearer
  // inside the route.
  if (pathname === '/api/peers/store' || pathname.startsWith('/api/peers/store/')) {
    return true
  }
  if (pathname.startsWith('/api/peers/agent/')) {
    return true
  }

  if (pathname.startsWith('/_next/') || pathname.startsWith('/favicon')) {
    return true
  }

  // Only top-level files from public/ may use the extension shortcut. App
  // routes such as `/backups/<id>.png` or API routes such as
  // `/api/backups/<id>.png` must stay behind the gate even though they look
  // like assets.
  if (TOP_LEVEL_ASSET.test(pathname)) return true

  return false
}
