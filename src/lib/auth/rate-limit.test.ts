import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  assertNotRateLimited,
  clientKeyFromRequest,
  clientKeyFromSessionOrRequest,
  recordAuthFailure,
  recordAuthSuccess,
  resetRateLimitForTests,
  sessionKeyFromCookieHeader,
} from './rate-limit'

describe('auth rate limit', () => {
  beforeEach(() => {
    resetRateLimitForTests()
  })

  afterEach(() => {
    delete process.env.AUTH_TRUST_PROXY
  })

  test('allows first attempts', () => {
    expect(assertNotRateLimited('login:instance')).toEqual({ ok: true })
  })

  test('backs off after repeated failures and recovers after success', () => {
    const key = 'login:test'
    for (let i = 0; i < 5; i++) {
      recordAuthFailure(key)
    }
    const blocked = assertNotRateLimited(key)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    }
    recordAuthSuccess(key)
    expect(assertNotRateLimited(key)).toEqual({ ok: true })
  })

  test('session keys are stable and do not expose the cookie', () => {
    const a = sessionKeyFromCookieHeader('other=1; lb_session=abc; x=2')
    const b = sessionKeyFromCookieHeader('lb_session=abc')
    expect(a).toBe(b)
    expect(a).not.toContain('abc')
    expect(sessionKeyFromCookieHeader(null)).toBe('no-session')
  })

  test('client key ignores X-Forwarded-For unless AUTH_TRUST_PROXY=true', () => {
    const request = {
      headers: new Headers({
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
        'x-real-ip': '203.0.113.6',
      }),
    }
    expect(clientKeyFromRequest(request)).toBe('instance')

    process.env.AUTH_TRUST_PROXY = 'true'
    expect(clientKeyFromRequest(request)).toBe('203.0.113.5')
    expect(
      clientKeyFromSessionOrRequest(request, 'lb_session=abc')
    ).toBe(`${sessionKeyFromCookieHeader('lb_session=abc')}:203.0.113.5`)
  })
})
