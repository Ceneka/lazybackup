import { describe, expect, test } from 'bun:test'
import { formatCronExpression, formatInTimezone, isValidTimezone } from './format'
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

  test('labels simple step schedules', () => {
    expect(formatCronExpression('0 */6 * * *')).toBe('Every 6 hours')
    expect(formatCronExpression('*/15 * * * *')).toBe('Every 15 minutes')
    expect(formatCronExpression('*/1 * * * *')).toBe('Every minute')
    expect(formatCronExpression('0 */1 * * *')).toBe('Hourly')
    expect(formatCronExpression('30 */4 * * *')).toBe('Every 4 hours at :30')
  })

  test('returns raw expression when not 5 fields', () => {
    expect(formatCronExpression('0 0 * *')).toBe('0 0 * *')
  })

  test('returns raw expression for ranges and lists', () => {
    expect(formatCronExpression('0 2 * * 1-5')).toBe('0 2 * * 1-5')
    expect(formatCronExpression('0 2 * * 1,3,5')).toBe('0 2 * * 1,3,5')
    expect(formatCronExpression('0 2 1,15 * *')).toBe('0 2 1,15 * *')
  })

  test('normalizes 7 to Sunday', () => {
    expect(formatCronExpression('0 2 * * 7')).toBe('Weekly on Sun at 02:00')
  })
})

describe('cronPresets', () => {
  test('labels match formatCronExpression', () => {
    expect(CRON_PRESET_EXPRESSIONS).toEqual([
      '0 * * * *',
      '0 2 * * *',
      '0 2 * * 0',
      '0 2 1 * *',
    ])
    expect(formatCronExpression('0 2 1 * *')).toBe('Monthly on day 1 at 02:00')
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

  test('formatInTimezone uses a stable en-US locale', () => {
    const d = new Date('2026-09-02T05:00:00.000Z')
    const s = formatInTimezone(d, 'UTC')
    expect(s).toContain('Sep')
    expect(s).toContain('2026')
    expect(s).toContain('5:00')
  })
})
