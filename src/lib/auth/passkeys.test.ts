import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  canDeletePasskey,
  resetWebauthnChallenges,
  saveWebauthnChallenge,
  takeWebauthnChallenge,
  webauthnRpFromRequest,
} from './webauthn'

function clientDataJSON(challenge: string): string {
  const json = JSON.stringify({
    type: 'webauthn.get',
    origin: 'http://localhost:3000',
    challenge,
  })
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('webauthnRpFromRequest', () => {
  const envKeys = ['AUTH_TRUST_PROXY', 'AUTH_PUBLIC_URL'] as const
  const previous: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of envKeys) {
      previous[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })

  test('uses host header and defaults http for localhost', () => {
    const headers = new Headers({ host: 'localhost:3000' })
    const { rpID, origin } = webauthnRpFromRequest({ headers })
    expect(rpID).toBe('localhost')
    expect(origin).toBe('http://localhost:3000')
  })

  test('ignores forwarded headers unless AUTH_TRUST_PROXY=true', () => {
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    })
    const { rpID, origin } = webauthnRpFromRequest({ headers })
    expect(rpID).toBe('internal')
    expect(origin).toBe('https://internal:3000')
  })

  test('respects forwarded headers when AUTH_TRUST_PROXY=true', () => {
    process.env.AUTH_TRUST_PROXY = 'true'
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'backup.example.com',
      'x-forwarded-proto': 'https',
    })
    const { rpID, origin } = webauthnRpFromRequest({ headers })
    expect(rpID).toBe('backup.example.com')
    expect(origin).toBe('https://backup.example.com')
  })

  test('prefers AUTH_PUBLIC_URL over Host and forwarded headers', () => {
    process.env.AUTH_PUBLIC_URL = 'https://backup.example.com'
    process.env.AUTH_TRUST_PROXY = 'true'
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'other.example',
      'x-forwarded-proto': 'http',
    })
    const { rpID, origin } = webauthnRpFromRequest({ headers })
    expect(rpID).toBe('backup.example.com')
    expect(origin).toBe('https://backup.example.com')
  })
})

describe('canDeletePasskey', () => {
  test('refuses to delete the last authenticator when no password is set', () => {
    expect(canDeletePasskey(1, false)).toBe(false)
  })

  test('allows deleting the last passkey when a password exists', () => {
    expect(canDeletePasskey(1, true)).toBe(true)
  })

  test('allows deleting when more than one passkey remains', () => {
    expect(canDeletePasskey(2, false)).toBe(true)
  })
})

describe('webauthn challenge store', () => {
  beforeEach(() => {
    resetWebauthnChallenges()
  })

  test('keys challenges separately so a public GET cannot overwrite another', () => {
    saveWebauthnChallenge('login', 'challenge-a')
    saveWebauthnChallenge('login', 'challenge-b')
    expect(takeWebauthnChallenge('login', clientDataJSON('challenge-a'))).toBe('challenge-a')
    expect(takeWebauthnChallenge('login', clientDataJSON('challenge-b'))).toBe('challenge-b')
  })

  test('rejects the wrong kind and consumes on take', () => {
    saveWebauthnChallenge('register', 'challenge-c')
    expect(takeWebauthnChallenge('login', clientDataJSON('challenge-c'))).toBeNull()
    saveWebauthnChallenge('register', 'challenge-c')
    expect(takeWebauthnChallenge('register', clientDataJSON('challenge-c'))).toBe('challenge-c')
    expect(takeWebauthnChallenge('register', clientDataJSON('challenge-c'))).toBeNull()
  })
})
