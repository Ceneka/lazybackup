import { describe, expect, test } from 'bun:test'
import { localDayRange, toLocalDateKey, zonedDayRange } from './local-date'

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

describe('zonedDayRange', () => {
  test('maps a day key to app-timezone midnights', () => {
    const range = zonedDayRange('2026-07-01', 'America/New_York')
    expect(range?.start.toISOString()).toBe('2026-07-01T04:00:00.000Z')
    expect(range?.end.toISOString()).toBe('2026-07-02T04:00:00.000Z')
    expect(zonedDayRange('2026-02-31', 'UTC')).toBeNull()
  })
})
