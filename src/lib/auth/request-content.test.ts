import { describe, expect, test } from 'bun:test'
import {
  hasJsonContentType,
  hasRequestBody,
  requiresJsonMutationContentType,
} from './request-content'

function headers(value: string | null): { get(name: string): string | null } {
  return {
    get(name: string) {
      return name.toLowerCase() === 'content-type' ? value : null
    },
  }
}

function multi(values: Record<string, string>): { get(name: string): string | null } {
  const lowered = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  )
  return {
    get(name: string) {
      return lowered.get(name.toLowerCase()) ?? null
    },
  }
}

describe('hasJsonContentType', () => {
  test('accepts application/json with optional parameters', () => {
    expect(hasJsonContentType(headers('application/json'))).toBe(true)
    expect(hasJsonContentType(headers('application/json; charset=utf-8'))).toBe(true)
    expect(hasJsonContentType(headers('Application/JSON'))).toBe(true)
  })

  test('rejects form-postable and missing content types', () => {
    for (const value of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/json-patch+json',
      '',
      null,
    ]) {
      expect(hasJsonContentType(headers(value))).toBe(false)
    }
  })
})

describe('hasRequestBody', () => {
  test('detects content-length and chunked bodies', () => {
    expect(hasRequestBody(multi({ 'content-length': '12' }))).toBe(true)
    expect(hasRequestBody(multi({ 'content-length': '0' }))).toBe(false)
    expect(hasRequestBody(multi({ 'transfer-encoding': 'chunked' }))).toBe(true)
    expect(hasRequestBody(multi({}))).toBe(false)
  })
})

describe('requiresJsonMutationContentType', () => {
  test('applies to API mutations that carry a body', () => {
    expect(
      requiresJsonMutationContentType(
        'POST',
        '/api/settings',
        multi({ 'content-length': '10' })
      )
    ).toBe(true)
    expect(
      requiresJsonMutationContentType('PATCH', '/api/servers/abc', multi({
        'content-length': '10',
      }))
    ).toBe(true)
    expect(
      requiresJsonMutationContentType('POST', '/mcp', multi({ 'content-length': '10' }))
    ).toBe(true)
  })

  test('bodyless mutations (run, delete, logout) stay allowed', () => {
    expect(
      requiresJsonMutationContentType('POST', '/api/backups/abc/run', multi({}))
    ).toBe(false)
    expect(
      requiresJsonMutationContentType('DELETE', '/api/servers/abc', multi({}))
    ).toBe(false)
    expect(
      requiresJsonMutationContentType('POST', '/api/auth/logout', multi({}))
    ).toBe(false)
  })

  test('does not apply to GET/HEAD/OPTIONS or non-API paths', () => {
    expect(
      requiresJsonMutationContentType('GET', '/api/settings', multi({ 'content-length': '1' }))
    ).toBe(false)
    expect(
      requiresJsonMutationContentType('POST', '/login', multi({ 'content-length': '1' }))
    ).toBe(false)
  })
})
