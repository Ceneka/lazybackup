import { describe, expect, test } from 'bun:test'
import {
  compareSemver,
  isNewerVersion,
  isPrereleaseTag,
  parseSemver,
  stripVersionPrefix,
} from './semver'

describe('stripVersionPrefix', () => {
  test('drops leading v', () => {
    expect(stripVersionPrefix('v0.3.0')).toBe('0.3.0')
    expect(stripVersionPrefix('V0.2.0')).toBe('0.2.0')
    expect(stripVersionPrefix('0.2.0')).toBe('0.2.0')
  })
})

describe('parseSemver', () => {
  test('reads major.minor.patch', () => {
    expect(parseSemver('v0.3.0')).toEqual([0, 3, 0])
    expect(parseSemver('1.2.10')).toEqual([1, 2, 10])
  })

  test('rejects non-semver tags', () => {
    expect(parseSemver('lazybro')).toBeNull()
    expect(parseSemver('')).toBeNull()
    expect(parseSemver('latest')).toBeNull()
  })
})

describe('isPrereleaseTag', () => {
  test('detects hyphen suffixes', () => {
    expect(isPrereleaseTag('v0.3.0-rc.1')).toBe(true)
    expect(isPrereleaseTag('0.3.0-beta.1')).toBe(true)
    expect(isPrereleaseTag('v0.3.0')).toBe(false)
    expect(isPrereleaseTag('0.3.0+build')).toBe(false)
  })
})

describe('compareSemver / isNewerVersion', () => {
  test('0.2.0 vs v0.3.0 is an update', () => {
    expect(isNewerVersion('v0.3.0', '0.2.0')).toBe(true)
    expect(compareSemver('v0.3.0', '0.2.0')).toBe(1)
  })

  test('equal versions are not an update', () => {
    expect(isNewerVersion('v0.2.0', '0.2.0')).toBe(false)
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false)
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0)
  })

  test('older latest is not an update', () => {
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false)
    expect(compareSemver('0.1.9', '0.2.0')).toBe(-1)
  })

  test('malformed input does not throw', () => {
    expect(() => isNewerVersion('nope', '0.2.0')).not.toThrow()
    expect(() => isNewerVersion('', '')).not.toThrow()
    expect(() => compareSemver('lazybro', '0.2.0')).not.toThrow()
    expect(isNewerVersion('nope', '0.2.0')).toBe(false)
    expect(isNewerVersion('lazybro', '0.2.0')).toBe(false)
    expect(compareSemver('nope', '0.2.0')).toBeNull()
  })

  test('ignores pre-release latest tags', () => {
    expect(isNewerVersion('v0.3.0-rc.1', '0.2.0')).toBe(false)
  })
})
