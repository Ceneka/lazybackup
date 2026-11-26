import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { csrfDecisionForSessionRequest, isUnsafeMethod } from './csrf'

const ENV_KEYS = ['AUTH_TRUST_PROXY', 'AUTH_PUBLIC_URL'] as const
const previous: Record<string, string | undefined> = {}

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

describe('isUnsafeMethod', () => {
  test('only safe methods pass', () => {
    expect(isUnsafeMethod('GET')).toBe(false)
    expect(isUnsafeMethod('head')).toBe(false)
    expect(isUnsafeMethod('OPTIONS')).toBe(false)
    expect(isUnsafeMethod('POST')).toBe(true)
    expect(isUnsafeMethod('PUT')).toBe(true)
    expect(isUnsafeMethod('PATCH')).toBe(true)
    expect(isUnsafeMethod('DELETE')).toBe(true)
  })
})

describe('csrfDecisionForSessionRequest', () => {
  test('safe methods always pass', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'GET',
        headers: headers({ 'sec-fetch-site': 'cross-site' }),
      })
    ).toEqual({ ok: true })
  })

  test('Sec-Fetch-Site same-origin and none pass; same-site/cross-site fail', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({ 'sec-fetch-site': 'same-origin' }),
      })
    ).toEqual({ ok: true })
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({ 'sec-fetch-site': 'none' }),
      })
    ).toEqual({ ok: true })
    for (const site of ['same-site', 'cross-site', 'evil']) {
      const decision = csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({ 'sec-fetch-site': site }),
      })
      expect(decision.ok).toBe(false)
    }
  })

  test('Origin host must match Host when Sec-Fetch-Site is absent', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({
          host: 'backup.example:8080',
          origin: 'http://backup.example:8080',
        }),
      })
    ).toEqual({ ok: true })

    const mismatch = csrfDecisionForSessionRequest({
      method: 'POST',
      headers: headers({
        host: 'backup.example',
        origin: 'http://evil.example',
      }),
    })
    expect(mismatch.ok).toBe(false)
  })

  test('allows non-browser clients with neither Origin nor Sec-Fetch-Site', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({ host: 'backup.example' }),
      })
    ).toEqual({ ok: true })
  })

  test('rejects Origin: null and malformed origins', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({ host: 'backup.example', origin: 'null' }),
      }).ok
    ).toBe(false)
  })

  test('ignores X-Forwarded-Host unless AUTH_TRUST_PROXY=true', () => {
    const base = {
      method: 'POST',
      headers: headers({
        host: 'internal:3000',
        'x-forwarded-host': 'backup.example.com',
        origin: 'https://backup.example.com',
      }),
    }
    expect(csrfDecisionForSessionRequest(base).ok).toBe(false)

    process.env.AUTH_TRUST_PROXY = 'true'
    expect(csrfDecisionForSessionRequest(base)).toEqual({ ok: true })
  })

  test('AUTH_PUBLIC_URL wins over Host and forwarded headers', () => {
    process.env.AUTH_PUBLIC_URL = 'https://backup.example.com'
    process.env.AUTH_TRUST_PROXY = 'true'
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({
          host: 'internal:3000',
          'x-forwarded-host': 'other.example',
          origin: 'https://backup.example.com',
        }),
      })
    ).toEqual({ ok: true })
    expect(
      csrfDecisionForSessionRequest({
        method: 'DELETE',
        headers: headers({
          host: 'internal:3000',
          origin: 'https://other.example',
        }),
      }).ok
    ).toBe(false)
  })

  test('host comparison is case-insensitive', () => {
    expect(
      csrfDecisionForSessionRequest({
        method: 'POST',
        headers: headers({
          host: 'Backup.Example',
          origin: 'https://backup.example',
        }),
      })
    ).toEqual({ ok: true })
  })
})
