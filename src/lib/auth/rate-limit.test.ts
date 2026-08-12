import { describe, expect, test, beforeEach } from 'bun:test'
import {
  assertNotRateLimited,
  recordAuthFailure,
  recordAuthSuccess,
  resetRateLimitForTests,
} from './rate-limit'

describe('auth rate limit', () => {
  beforeEach(() => {
    resetRateLimitForTests()
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
})
