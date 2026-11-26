import { describe, expect, test } from 'bun:test'
import { hasJsonContentType } from './request-content'

function headers(value: string | null): { get(name: string): string | null } {
  return {
    get(name: string) {
      return name.toLowerCase() === 'content-type' ? value : null
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
