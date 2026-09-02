// CronTime only — CronJob pulls child_process and is not safe in client components.
import { CronTime } from 'cron/dist/time.js'
import {
  DEFAULT_TIMEZONE,
  formatCronExpression,
  formatInTimezone,
  isValidTimezone,
  type UpcomingBackup,
} from './format'

export type { UpcomingBackup }

/** Next fire time for a cron expression in the given IANA timezone. */
export function getNextCronDate(schedule: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  if (!isValidTimezone(timeZone)) return null

  try {
    return new CronTime(schedule, timeZone).sendAt().toJSDate()
  } catch {
    return null
  }
}

export function buildUpcomingEntry(
  config: { id: string; name: string; schedule: string; server?: { name?: string } | null },
  timeZone: string
): UpcomingBackup {
  const next = getNextCronDate(config.schedule, timeZone)
  return {
    id: config.id,
    name: config.name,
    schedule: config.schedule,
    scheduleLabel: formatCronExpression(config.schedule),
    nextRun: next?.toISOString() ?? null,
    nextRunFormatted: next ? formatInTimezone(next, timeZone) : null,
    timezone: timeZone,
    serverName: config.server?.name ?? null,
  }
}
