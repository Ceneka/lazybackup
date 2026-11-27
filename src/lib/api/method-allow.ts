/**
 * HTTP methods exported by each **static** API route (`route.ts` without a
 * dynamic segment).
 *
 * Next answers a method its route handler does not export with a bare empty
 * 405. The auth middleware consults this map instead so API clients get
 * `{ "error": "Method not allowed" }` plus an `Allow` header.
 *
 * Dynamic routes (`[id]`, `[...notFound]`, …) are deliberately absent: the
 * middleware cannot know their methods without importing every route module.
 * `method-allow.test.ts` reads the route files and fails if this map drifts.
 *
 * Keep paths sorted. `HEAD` is included wherever `GET` is exported (Next
 * serves HEAD from GET); `OPTIONS` is added by `allowListForPath`, not stored.
 */

/** Canonical order for `Allow` headers. */
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

const METHOD_RANK = new Map<string, number>(
  METHOD_ORDER.map((method, index) => [method, index])
)

function orderedMethods(methods: readonly string[]): string[] {
  return [...methods].sort(
    (a, b) => (METHOD_RANK.get(a) ?? METHOD_ORDER.length) - (METHOD_RANK.get(b) ?? METHOD_ORDER.length)
  )
}

export const API_METHOD_ALLOW: Record<string, readonly string[]> = {
  '/api/api-tokens': ['GET', 'HEAD', 'POST'],
  '/api/auth/login': ['POST'],
  '/api/auth/logout': ['POST'],
  '/api/auth/password': ['POST'],
  '/api/auth/setup': ['POST'],
  '/api/auth/status': ['GET', 'HEAD'],
  '/api/auth/webauthn/credentials': ['GET', 'HEAD', 'DELETE'],
  '/api/auth/webauthn/login': ['GET', 'HEAD', 'POST'],
  '/api/auth/webauthn/register': ['GET', 'HEAD', 'POST'],
  '/api/auth/webauthn/step-up': ['GET', 'HEAD', 'POST'],
  '/api/backups': ['GET', 'HEAD', 'POST'],
  '/api/backups/database/test': ['POST'],
  '/api/backups/start': ['POST'],
  '/api/backups/storage-root': ['GET', 'HEAD'],
  '/api/dashboard': ['GET', 'HEAD'],
  '/api/docker/containers': ['GET', 'HEAD'],
  '/api/docker/volumes': ['GET', 'HEAD'],
  '/api/encryption': ['GET', 'HEAD', 'POST'],
  '/api/events': ['GET', 'HEAD'],
  '/api/git-repos': ['GET', 'HEAD', 'POST'],
  '/api/git-repos/test': ['POST'],
  '/api/health': ['GET', 'HEAD'],
  '/api/history': ['GET', 'HEAD'],
  '/api/history/stats': ['GET', 'HEAD'],
  '/api/peers': ['GET', 'HEAD', 'POST'],
  '/api/peers/addresses': ['GET', 'HEAD'],
  '/api/peers/agent/ack': ['POST'],
  '/api/peers/agent/pending': ['GET', 'HEAD'],
  '/api/peers/agent/ping': ['GET', 'HEAD', 'POST'],
  '/api/peers/agent/work': ['GET', 'HEAD'],
  '/api/peers/pair': ['POST'],
  '/api/peers/recall': ['POST'],
  '/api/peers/store': ['GET', 'HEAD', 'PUT', 'DELETE'],
  '/api/peers/tailscale': ['GET', 'HEAD', 'POST'],
  '/api/s3-profiles': ['GET', 'HEAD', 'POST'],
  '/api/s3-profiles/test': ['POST'],
  '/api/scheduler/restart': ['POST'],
  '/api/seed': ['POST'],
  '/api/servers': ['GET', 'HEAD', 'POST'],
  '/api/servers/test': ['POST'],
  '/api/settings': ['GET', 'HEAD', 'POST', 'DELETE'],
  '/api/settings/export': ['GET', 'HEAD'],
  '/api/settings/success-ping-test': ['POST'],
  '/api/settings/webhook-test': ['POST'],
  '/api/ssh-keys': ['GET', 'HEAD', 'POST'],
  '/api/ssh-keys/generate': ['POST'],
  '/api/status': ['GET', 'HEAD'],
  '/api/version': ['GET', 'HEAD'],
}

/**
 * Allowed methods for a static API path, including `OPTIONS`, in canonical
 * order. `undefined` for unknown paths and dynamic routes so the middleware
 * falls through to Next unchanged.
 */
export function allowListForPath(pathname: string): string[] | undefined {
  const methods = API_METHOD_ALLOW[pathname]
  if (!methods) return undefined
  return orderedMethods([...methods, 'OPTIONS'])
}
