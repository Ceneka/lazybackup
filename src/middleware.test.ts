import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'

/**
 * CSRF matrix at the middleware boundary. Auth internals are mocked so the
 * test exercises the gate order (session vs bearer, headers, content type)
 * without SQLite or argon2.
 */

type Via = 'unlocked' | 'session' | 'bearer' | 'none'

const state: { via: Via; readOnly: boolean } = {
  via: 'session',
  readOnly: false,
}

mock.module('@/lib/auth', () => ({
  getAuthStatus: async () => ({
    authEnabled: true,
    authSetupCompleted: true,
    authenticated: true,
    hasPassword: true,
    hasPasskeys: false,
  }),
  maybeRefreshSessionCookie: async () => {},
  resolveAuth: async () => ({
    authorized: true,
    via: state.via,
    ...(state.via === 'bearer'
      ? {
          apiToken: {
            id: 'tok',
            name: 'test',
            permissions: state.readOnly ? ['read_only'] : [],
          },
        }
      : {}),
  }),
  authAllowsWrite: () => !state.readOnly,
  isReadOnlyApiException: (_method: string, pathname: string) =>
    /^\/api\/servers\/[^/]+\/test$/.test(pathname),
}))

const { middleware } = await import('./middleware')

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost:3261${path}`, {
    method: init.method ?? 'POST',
    headers: {
      cookie: 'lb_session=test',
      ...init.headers,
    },
  })
}

beforeEach(() => {
  state.via = 'session'
  state.readOnly = false
  delete process.env.AUTH_PUBLIC_URL
  delete process.env.AUTH_TRUST_PROXY
})

describe('middleware CSRF', () => {
  test('session POST with same-origin fetch metadata passes', async () => {
    const res = await middleware(
      request('/api/settings', { headers: { 'sec-fetch-site': 'same-origin' } })
    )
    expect(res.status).toBe(200)
  })

  test('session POST with cross-site fetch metadata is 403', async () => {
    const res = await middleware(
      request('/api/settings', { headers: { 'sec-fetch-site': 'cross-site' } })
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('Cross-site'),
    })
  })

  test('session POST with mismatched Origin (no fetch metadata) is 403', async () => {
    const res = await middleware(
      request('/api/settings', { headers: { origin: 'https://evil.example' } })
    )
    expect(res.status).toBe(403)
  })

  test('session POST with matching Origin passes', async () => {
    const res = await middleware(
      request('/api/settings', {
        headers: {
          host: 'localhost:3261',
          origin: 'http://localhost:3261',
        },
      })
    )
    expect(res.status).toBe(200)
  })

  test('Bearer tokens are exempt from the CSRF check', async () => {
    state.via = 'bearer'
    const res = await middleware(
      request('/api/settings', {
        headers: {
          authorization: 'Bearer lb_test',
          'sec-fetch-site': 'cross-site',
          origin: 'https://evil.example',
        },
      })
    )
    expect(res.status).toBe(200)
  })

  test('GET is never blocked', async () => {
    const res = await middleware(
      request('/api/settings', {
        method: 'GET',
        headers: { 'sec-fetch-site': 'cross-site' },
      })
    )
    expect(res.status).toBe(200)
  })
})

describe('middleware JSON content type', () => {
  test('rejects text/plain bodies on API mutations', async () => {
    const res = await middleware(
      request('/api/settings', {
        headers: {
          'sec-fetch-site': 'same-origin',
          'content-type': 'text/plain',
          'content-length': '8',
        },
      })
    )
    expect(res.status).toBe(415)
  })

  test('accepts application/json bodies', async () => {
    const res = await middleware(
      request('/api/settings', {
        headers: {
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'content-length': '8',
        },
      })
    )
    expect(res.status).toBe(200)
  })

  test('bodyless POST stays allowed', async () => {
    const res = await middleware(
      request('/api/backups/abc/run', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin' },
      })
    )
    expect(res.status).toBe(200)
  })
})

describe('middleware read_only probes', () => {
  test('read_only bearer cannot call ad-hoc test routes', async () => {
    state.via = 'bearer'
    state.readOnly = true
    const res = await middleware(
      request('/api/servers/test', {
        headers: {
          authorization: 'Bearer lb_test',
          'content-type': 'application/json',
          'content-length': '2',
        },
      })
    )
    expect(res.status).toBe(403)
  })

  test('read_only bearer can test a stored endpoint by id', async () => {
    state.via = 'bearer'
    state.readOnly = true
    const res = await middleware(
      request('/api/servers/abc/test', {
        headers: {
          authorization: 'Bearer lb_test',
          'content-type': 'application/json',
          'content-length': '2',
        },
      })
    )
    expect(res.status).toBe(200)
  })
})
