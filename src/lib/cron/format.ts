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
 */
export function formatCronExpression(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return cronExpression

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const timeLabel =
    minute !== '*' && hour !== '*'
      ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      : null

  // * * * * * — every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute'
  }

  // m * * * * — every hour at minute m
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && minute !== '*') {
    return minute === '0' ? 'Hourly' : `Hourly at :${minute.padStart(2, '0')}`
  }

  // m h * * * — daily
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return timeLabel ? `Daily at ${timeLabel}` : 'Daily'
  }

  // m h * * d — weekly
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const dayLabel = formatDayOfWeek(dayOfWeek)
    return timeLabel ? `Weekly on ${dayLabel} at ${timeLabel}` : `Weekly on ${dayLabel}`
  }

  // m h d * * — monthly
  if (month === '*' && dayOfWeek === '*' && dayOfMonth !== '*') {
    return timeLabel
      ? `Monthly on day ${dayOfMonth} at ${timeLabel}`
      : `Monthly on day ${dayOfMonth}`
  }

  return cronExpression
}

function formatDayOfWeek(field: string): string {
  if (/^\d+$/.test(field)) {
    const n = Number(field)
    if (n >= 0 && n <= 6) return WEEKDAY_NAMES[n]
  }
  return field
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
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(date)
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
