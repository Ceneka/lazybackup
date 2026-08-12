import { describe, expect, test } from 'bun:test'
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
} from './constants'
import {
  clearSessionCookieOptions,
  createSessionToken,
  inspectSessionToken,
  parseCookieValue,
  sessionCookieOptions,
  sessionNeedsRefresh,
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
    const parts = token.split('.')
    const forged = `${parts[0]}.${parts[1]}.deadbeef`
    expect(await verifySessionToken(secret, forged)).toBe(false)
  })

  test('rejects expired tokens', async () => {
    const token = await createSessionToken(secret, -10)
    expect(await verifySessionToken(secret, token)).toBe(false)
  })

  test('rejects wrong secret', async () => {
    const token = await createSessionToken(secret, 60)
    expect(await verifySessionToken('other-secret', token)).toBe(false)
  })

  test('binds HMAC payload to session epoch', async () => {
    const token = await createSessionToken(secret, 60, 3)
    expect(await verifySessionToken(secret, token, 3)).toBe(true)
    expect(await verifySessionToken(secret, token, 4)).toBe(false)
    expect(await verifySessionToken(secret, token, 0)).toBe(false)
  })

  test('epoch bump invalidates previously issued tokens', async () => {
    const token = await createSessionToken(secret, 60, 1)
    expect(await inspectSessionToken(secret, token, 1)).toEqual({
      ok: true,
      exp: expect.any(Number),
      epoch: 1,
    })
    expect(await inspectSessionToken(secret, token, 2)).toEqual({ ok: false })
  })

  test('accepts legacy exp.sig tokens only at epoch 0', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(String(exp))
    )
    let binary = ''
    for (const byte of new Uint8Array(signature)) {
      binary += String.fromCharCode(byte)
    }
    const sig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const legacy = `${exp}.${sig}`
    expect(await verifySessionToken(secret, legacy, 0)).toBe(true)
    expect(await verifySessionToken(secret, legacy, 1)).toBe(false)
  })
})

describe('session refresh window', () => {
  test('does not refresh a freshly issued 30-day token', () => {
    const now = 1_700_000_000
    const exp = now + SESSION_MAX_AGE_SECONDS
    expect(sessionNeedsRefresh(exp, now)).toBe(false)
  })

  test('refreshes after the idle window', () => {
    const now = 1_700_000_000
    const exp = now + SESSION_MAX_AGE_SECONDS - SESSION_REFRESH_AFTER_SECONDS
    expect(sessionNeedsRefresh(exp, now)).toBe(true)
  })

  test('does not refresh an already-expired token', () => {
    const now = 1_700_000_000
    expect(sessionNeedsRefresh(now - 1, now)).toBe(false)
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

describe('parseCookieValue', () => {
  test('reads a named cookie', () => {
    expect(parseCookieValue('lb_session=abc; other=1', 'lb_session')).toBe('abc')
  })

  test('treats invalid percent-encoding as unauthenticated', () => {
    expect(parseCookieValue('lb_session=%', 'lb_session')).toBeUndefined()
    expect(parseCookieValue('lb_session=%E0%A4%A', 'lb_session')).toBeUndefined()
  })

  test('returns undefined when missing', () => {
    expect(parseCookieValue(null, 'lb_session')).toBeUndefined()
    expect(parseCookieValue('other=1', 'lb_session')).toBeUndefined()
  })
})
