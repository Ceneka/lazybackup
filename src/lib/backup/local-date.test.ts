import { describe, expect, test } from 'bun:test'
import { localDayRange, toLocalDateKey } from './local-date'

describe('toLocalDateKey', () => {
  test('formats a local calendar day as YYYY-MM-DD', () => {
    expect(toLocalDateKey(new Date(2026, 8, 5, 18, 30))).toBe('2026-09-05')
  })
})

describe('localDayRange', () => {
  test('returns local midnight bounds for a valid day', () => {
    const range = localDayRange('2026-09-05')
    expect(range).not.toBeNull()
    expect(range!.start).toEqual(new Date(2026, 8, 5))
    expect(range!.end).toEqual(new Date(2026, 8, 6))
  })

  test('rejects impossible calendar dates', () => {
    expect(localDayRange('2026-02-31')).toBeNull()
    expect(localDayRange('not-a-day')).toBeNull()
    expect(localDayRange('')).toBeNull()
  })
})
