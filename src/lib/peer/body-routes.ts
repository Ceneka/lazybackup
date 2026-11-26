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

/** Middleware matcher shared by `src/middleware.ts` and its regression test. */
export const MIDDLEWARE_MATCHER = `/((?!_next/static|_next/image|favicon.ico|${PEER_BODY_ROUTE_PREFIXES.join('|')}).*)`;
