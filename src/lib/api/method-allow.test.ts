import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { API_METHOD_ALLOW, allowListForPath } from './method-allow'

/**
 * Drift guard: `API_METHOD_ALLOW` must mirror the exported HTTP methods of
 * every static `src/app/api/**\/route.ts`, and must not contain dynamic route
 * patterns. Plus the middleware behaviour the map exists for (JSON 405 + Allow,
 * OPTIONS 204) with auth mocked so the gate order is testable without SQLite.
 */

const API_DIR = path.resolve(import.meta.dir, '../../app/api')
const CANONICAL_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const METHOD_EXPORT =
  /^export\s+(?:async\s+)?function\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gm
const CONST_EXPORT =
  /^export\s+const\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gm
const REEXPORT = /^export\s*\{([^}]*)\}/gm

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

function apiPathForFile(file: string): string {
  const relative = path.relative(API_DIR, path.dirname(file))
  if (!relative) return '/api'
  return `/api/${relative.split(path.sep).join('/')}`
}

function canonical(methods: readonly string[]): string[] {
  return [...methods].sort(
    (a, b) => CANONICAL_ORDER.indexOf(a) - CANONICAL_ORDER.indexOf(b)
  )
}

function exportedMethods(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(METHOD_EXPORT)) found.add(match[1])
  for (const match of source.matchAll(CONST_EXPORT)) found.add(match[1])
  // Handles `export { handler as GET }` re-exports (used by the /api catch-all).
  for (const match of source.matchAll(REEXPORT)) {
    for (const specifier of match[1].split(',')) {
      const alias = specifier.trim().split(/\s+as\s+/i)[1]?.trim()
      if (alias && CANONICAL_ORDER.includes(alias)) found.add(alias)
    }
  }
  return canonical([...found])
}

function scanRoutes(): { expected: Map<string, string[]>; dynamic: string[] } {
  const expected = new Map<string, string[]>()
  const dynamic: string[] = []
  for (const file of routeFiles(API_DIR)) {
    const urlPath = apiPathForFile(file)
    if (urlPath.includes('[')) {
      dynamic.push(urlPath)
      continue
    }
    const methods = exportedMethods(readFileSync(file, 'utf8'))
    if (methods.length === 0) {
      throw new Error(`${urlPath} exports no HTTP methods`)
    }
    // Next serves HEAD from GET.
    if (methods.includes('GET') && !methods.includes('HEAD')) methods.push('HEAD')
    expected.set(urlPath, canonical(methods))
  }
  return { expected, dynamic }
}

describe('API_METHOD_ALLOW drift', () => {
  const { expected, dynamic } = scanRoutes()

  test('the scan finds both static and dynamic API routes', () => {
    expect(expected.size).toBeGreaterThan(0)
    expect(dynamic.length).toBeGreaterThan(0)
  })

  test('map keys match the static route paths exactly, sorted', () => {
    expect(Object.keys(API_METHOD_ALLOW)).toEqual([...expected.keys()].sort())
  })

  test('every static route exposes exactly the mapped methods', () => {
    const problems: string[] = []
    for (const [urlPath, methods] of expected) {
      const mapped = API_METHOD_ALLOW[urlPath]
      if (!mapped) {
        problems.push(`${urlPath}: missing from API_METHOD_ALLOW`)
        continue
      }
      if (mapped.join(',') !== methods.join(',')) {
        problems.push(
          `${urlPath}: route exports ${methods.join(', ')} but map has ${mapped.join(', ')}`
        )
      }
    }
    expect(problems).toEqual([])
  })

  test('dynamic routes stay out of the map', () => {
    for (const urlPath of dynamic) {
      expect(API_METHOD_ALLOW[urlPath]).toBeUndefined()
      expect(allowListForPath(urlPath)).toBeUndefined()
    }
  })

  test('entries are static, unique, canonically ordered API paths', () => {
    for (const [urlPath, methods] of Object.entries(API_METHOD_ALLOW)) {
      expect(urlPath.startsWith('/api/')).toBe(true)
      expect(urlPath).not.toContain('[')
      expect(urlPath.endsWith('/')).toBe(false)
      expect(new Set(methods).size).toBe(methods.length)
      expect(methods).toEqual(canonical(methods))
      expect(methods).not.toContain('OPTIONS')
      if (methods.includes('GET')) expect(methods).toContain('HEAD')
    }
  })
})

describe('allowListForPath', () => {
  test('appends OPTIONS to the route methods', () => {
    expect(allowListForPath('/api/health')).toEqual(['GET', 'HEAD', 'OPTIONS'])
    expect(allowListForPath('/api/settings')).toEqual([
      'GET',
      'HEAD',
      'POST',
      'DELETE',
      'OPTIONS',
    ])
    expect(allowListForPath('/api/scheduler/restart')).toEqual(['POST', 'OPTIONS'])
  })

  test('unknown, dynamic and non-API paths return undefined', () => {
    expect(allowListForPath('/api/backups/abc')).toBeUndefined()
    expect(allowListForPath('/api/does-not-exist')).toBeUndefined()
    expect(allowListForPath('/login')).toBeUndefined()
  })
})

// Middleware imports @/lib/auth, which touches SQLite. Mock the gate the same
// way src/middleware.test.ts does so this file can exercise the 405 ordering.
type AuthState = { authenticated: boolean }
const authState: AuthState = { authenticated: true }

const realAuth = await import(`../auth/index.ts?real=${Date.now()}`)

mock.module('@/lib/auth', () => ({
  ...realAuth,
  getAuthStatus: async () => ({
    authEnabled: true,
    authSetupCompleted: true,
    authenticated: authState.authenticated,
    hasPassword: true,
    hasPasskeys: false,
  }),
  maybeRefreshSessionCookie: async () => {},
  resolveAuth: async () => ({ authorized: true, via: 'session' }),
  authAllowsWrite: () => true,
  isReadOnlyApiException: () => true,
}))

const { middleware } = await import('../../middleware')

function request(
  pathname: string,
  init: { method?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost:3261${pathname}`, {
    method: init.method ?? 'GET',
    headers: {
      cookie: 'lb_session=test',
      ...init.headers,
    },
  })
}

beforeEach(() => {
  authState.authenticated = true
  delete process.env.AUTH_PUBLIC_URL
  delete process.env.AUTH_TRUST_PROXY
})

describe('middleware method guard', () => {
  test('unsupported method returns JSON 405 with an Allow header', async () => {
    const res = await middleware(request('/api/settings', { method: 'PATCH' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST, DELETE, OPTIONS')
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
  })

  test('OPTIONS returns 204 with the Allow header', async () => {
    const res = await middleware(request('/api/settings', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST, DELETE, OPTIONS')
  })

  test('HEAD is allowed wherever GET is', async () => {
    const res = await middleware(request('/api/health', { method: 'HEAD' }))
    expect(res.status).toBe(200)
  })

  test('unauthenticated callers still get 401 before any 405', async () => {
    authState.authenticated = false
    const res = await middleware(request('/api/settings', { method: 'PATCH' }))
    expect(res.status).toBe(401)
  })

  test('public API routes are guarded without auth', async () => {
    authState.authenticated = false
    const res = await middleware(request('/api/health', { method: 'POST' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  })

  test('dynamic routes fall through unchanged', async () => {
    const res = await middleware(
      request('/api/backups/abc/run', { method: 'POST' })
    )
    expect(res.status).toBe(200)
  })
})

afterAll(async () => {
  // Bun patches module namespaces in place: restore the real auth module so
  // later test files (e.g. src/middleware.test.ts) see every export.
  const freshAuth = await import(`../auth/index.ts?real=${Date.now()}`)
  mock.module('@/lib/auth', () => freshAuth)
})
