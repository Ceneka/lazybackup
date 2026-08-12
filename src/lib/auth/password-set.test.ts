import { describe, expect, test } from 'bun:test'
import { allowsPasswordSet } from './index'
import { assertPasswordStrength } from './password'
import { MIN_PASSWORD_LENGTH } from './constants'

describe('allowsPasswordSet', () => {
  test('rejects Bearer and unauthenticated callers', () => {
    expect(allowsPasswordSet('bearer')).toBe(false)
    expect(allowsPasswordSet('none')).toBe(false)
  })

  test('allows cookie session and unlocked first-run', () => {
    expect(allowsPasswordSet('session')).toBe(true)
    expect(allowsPasswordSet('unlocked')).toBe(true)
  })
})

describe('password strength', () => {
  test(`requires at least ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(assertPasswordStrength('short')).not.toBeNull()
    expect(assertPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull()
    expect(assertPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
  })
})
