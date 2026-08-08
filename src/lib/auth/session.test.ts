import { describe, expect, test } from 'bun:test'
import {
  createSessionToken,
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
