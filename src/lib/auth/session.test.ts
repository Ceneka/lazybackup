import { describe, expect, test } from 'bun:test'
import {
  clearSessionCookieOptions,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from './session'

describe('session tokens', () => {
  const secret = 'test-secret-value-for-hmac'

  test('creates and verifies a valid token', async () => {
    const token = await createSessionToken(secret, 60)
    expect(await verifySessionToken(secret, token)).toBe(true)
  })

  test('rejects tampered tokens', async () => {
    const token = await createSessionToken(secret, 60)
    const [payload] = token.split('.')
    expect(await verifySessionToken(secret, `${payload}.deadbeef`)).toBe(false)
  })

  test('rejects expired tokens', async () => {
    const token = await createSessionToken(secret, -10)
    expect(await verifySessionToken(secret, token)).toBe(false)
  })

  test('rejects wrong secret', async () => {
    const token = await createSessionToken(secret, 60)
    expect(await verifySessionToken('other-secret', token)).toBe(false)
  })
})

describe('session cookies', () => {
  test('defaults to non-Secure so HTTP LAN installs can keep the session', () => {
    const prev = process.env.AUTH_COOKIE_SECURE
    delete process.env.AUTH_COOKIE_SECURE
    try {
      expect(sessionCookieOptions().secure).toBe(false)
      expect(clearSessionCookieOptions().secure).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE
      else process.env.AUTH_COOKIE_SECURE = prev
    }
  })

  test('enables Secure when AUTH_COOKIE_SECURE=true', () => {
    const prev = process.env.AUTH_COOKIE_SECURE
    process.env.AUTH_COOKIE_SECURE = 'true'
    try {
      expect(sessionCookieOptions().secure).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE
      else process.env.AUTH_COOKIE_SECURE = prev
    }
  })
})
