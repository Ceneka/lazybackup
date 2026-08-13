import { describe, expect, test } from 'bun:test'
import { formatCronExpression, isValidTimezone } from './format'
import { getNextCronDate } from './next'
import { CRON_PRESET_EXPRESSIONS, cronPresets } from './presets'

describe('formatCronExpression', () => {
  test('labels daily midnight correctly (not hourly)', () => {
    expect(formatCronExpression('0 0 * * *')).toBe('Daily at 00:00')
  })

  test('labels hourly', () => {
    expect(formatCronExpression('0 * * * *')).toBe('Hourly')
    expect(formatCronExpression('15 * * * *')).toBe('Hourly at :15')
  })

  test('labels every minute', () => {
    expect(formatCronExpression('* * * * *')).toBe('Every minute')
  })

  test('labels daily at a specific time', () => {
    expect(formatCronExpression('30 9 * * *')).toBe('Daily at 09:30')
  })

  test('labels weekly', () => {
    expect(formatCronExpression('0 0 * * 0')).toBe('Weekly on Sun at 00:00')
    expect(formatCronExpression('0 12 * * 1')).toBe('Weekly on Mon at 12:00')
  })

  test('labels monthly', () => {
    expect(formatCronExpression('0 0 1 * *')).toBe('Monthly on day 1 at 00:00')
  })

  test('returns raw expression when not 5 fields', () => {
    expect(formatCronExpression('0 0 * *')).toBe('0 0 * *')
  })
})

describe('cronPresets', () => {
  test('labels match formatCronExpression', () => {
    expect(CRON_PRESET_EXPRESSIONS).toEqual(['0 * * * *', '0 2 * * *', '0 2 * * 0'])
    for (const preset of cronPresets()) {
      expect(preset.label).toBe(formatCronExpression(preset.expression))
    }
  })
})

describe('timezone helpers', () => {
  test('validates timezones', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true)
    expect(isValidTimezone('Not/A/Zone')).toBe(false)
  })

  test('next run for daily midnight in Argentina is 00:00 local', () => {
    const next = getNextCronDate('0 0 * * *', 'America/Argentina/Buenos_Aires')
    expect(next).not.toBeNull()
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(next!)
    const hour = parts.find((p) => p.type === 'hour')?.value
    const minute = parts.find((p) => p.type === 'minute')?.value
    // Some locales use 24 for midnight; normalize
    expect(['00', '24']).toContain(hour)
    expect(minute).toBe('00')
  })
})
