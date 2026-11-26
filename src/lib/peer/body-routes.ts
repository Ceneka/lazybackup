/**
 * Peer routes that stream request bodies: mailbox recall uploads and direct
 * opaque-store PUTs (up to 32 GiB).
 *
 * They must not pass through Next.js middleware. Node middleware clones the
 * request body with a 10 MiB default limit (`experimental.middlewareClientMaxBodySize`)
 * and finalizes asynchronously, which truncates larger uploads and races the
 * route handler's own read of `request.body`. These routes authenticate with
 * the `lbpeer_` Bearer token inside the handler, so the password gate is not
 * needed for them either.
 */
export const PEER_BODY_ROUTE_PREFIXES = ['api/peers/store', 'api/peers/agent'] as const;

/**
 * Must equal the string literal in `src/middleware.ts` `config.matcher`
 * (Next only accepts a statically analyzable literal there). Segment-bounded so
 * a future `/api/peers/storage-*` route is not silently taken out of the gate.
 */
export const MIDDLEWARE_MATCHER =
  '/((?!_next/static|_next/image|favicon.ico|api/peers/store$|api/peers/store/|api/peers/agent/).*)';
