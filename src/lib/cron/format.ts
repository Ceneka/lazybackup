export const DEFAULT_TIMEZONE = 'UTC'

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Common IANA zones for the settings picker (full list available via Intl). */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'America/Santiago',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

export function isValidTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone })
    return true
  } catch {
    return false
  }
}

export function listTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return (Intl as typeof Intl & { supportedValuesOf(key: 'timeZone'): string[] }).supportedValuesOf(
        'timeZone'
      )
    }
  } catch {
    // fall through
  }
  return [...COMMON_TIMEZONES]
}

/**
 * Human-readable label for a 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 *
 * Only plain numbers, `*`, and simple `*\/n` steps (minutes/hours) are
 * humanized. Ranges and lists (`1-5`, `1,3,5`) fall back to the raw expression
 * so the label can never describe a schedule incorrectly.
 */
export function formatCronExpression(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return cronExpression

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (
    !isSupportedField(minute, 0, 59, true) ||
    !isSupportedField(hour, 0, 23, true) ||
    !isSupportedField(dayOfMonth, 1, 31) ||
    !isSupportedField(month, 1, 12) ||
    !isSupportedField(dayOfWeek, 0, 7)
  ) {
    return cronExpression
  }

  // * * * * * — every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute'
  }

  // */n * * * * — every n minutes
  const everyMinutes = parseStepField(minute, 0, 59)
  if (
    everyMinutes !== null &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return everyMinutes === 1 ? 'Every minute' : `Every ${everyMinutes} minutes`
  }

  const minuteNumber = parsePlainField(minute, 0, 59)
  if (minuteNumber === null) return cronExpression

  // m */n * * * — every n hours at minute m
  const everyHours = parseStepField(hour, 0, 23)
  if (everyHours !== null && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (everyHours === 1) {
      return minuteNumber === 0 ? 'Hourly' : `Hourly at :${pad2(minuteNumber)}`
    }
    const base = `Every ${everyHours} hours`
    return minuteNumber === 0 ? base : `${base} at :${pad2(minuteNumber)}`
  }

  // m * * * * — every hour at minute m
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return minuteNumber === 0 ? 'Hourly' : `Hourly at :${pad2(minuteNumber)}`
  }

  const hourNumber = parsePlainField(hour, 0, 23)
  if (hourNumber === null) return cronExpression
  const timeLabel = `${pad2(hourNumber)}:${pad2(minuteNumber)}`

  // m h * * * — daily
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${timeLabel}`
  }

  // m h * * d — weekly (single weekday only)
  if (dayOfMonth === '*' && month === '*') {
    const dayNumber = parsePlainField(dayOfWeek, 0, 7)
    if (dayNumber === null) return cronExpression
    // Cron accepts both 0 and 7 for Sunday.
    return `Weekly on ${WEEKDAY_NAMES[dayNumber === 7 ? 0 : dayNumber]} at ${timeLabel}`
  }

  // m h d * * — monthly (single day of month only)
  if (month === '*' && dayOfWeek === '*') {
    const dayOfMonthNumber = parsePlainField(dayOfMonth, 1, 31)
    if (dayOfMonthNumber === null) return cronExpression
    return `Monthly on day ${dayOfMonthNumber} at ${timeLabel}`
  }

  return cronExpression
}

function isSupportedField(
  field: string,
  min: number,
  max: number,
  allowStep = false
): boolean {
  if (field === '*') return true
  if (parsePlainField(field, min, max) !== null) return true
  return allowStep && parseStepField(field, min, max) !== null
}

function parsePlainField(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null
  const value = Number(field)
  return value >= min && value <= max ? value : null
}

function parseStepField(field: string, min: number, max: number): number | null {
  const match = /^\*\/(\d+)$/.exec(field)
  if (!match) return null
  const value = Number(match[1])
  return value >= Math.max(1, min) && value <= max ? value : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatInTimezone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  }
): string {
  try {
    // Fixed locale so SSR and the browser agree (avoids hydration mismatches
    // on the backup form next-run preview).
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date)
  } catch {
    return date.toISOString()
  }
}

export type UpcomingBackup = {
  id: string
  name: string
  schedule: string
  scheduleLabel: string
  nextRun: string | null
  nextRunFormatted: string | null
  timezone: string
  serverName?: string | null
}
