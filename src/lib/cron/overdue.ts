import { CronJob } from 'cron'
import { DEFAULT_TIMEZONE, isValidTimezone } from './format'

const GRACE_MS = 2 * 60 * 60 * 1000

/** Gap between the next two fires (used as the expected period). */
export function estimateCronIntervalMs(
  schedule: string,
  timeZone: string = DEFAULT_TIMEZONE
): number | null {
  if (!isValidTimezone(timeZone)) return null
  try {
    const job = CronJob.from({
      cronTime: schedule,
      onTick: () => {},
      start: false,
      timeZone,
    })
    const dates = job.nextDates(2)
    if (dates.length < 2) return null
    const first = dates[0]?.toJSDate().getTime()
    const second = dates[1]?.toJSDate().getTime()
    if (first == null || second == null) return null
    const delta = second - first
    return delta > 0 ? delta : null
  } catch {
    return null
  }
}

/**
 * True when the last completed run (or createdAt if never run) is older than
 * one cron interval plus a 2h grace. Invalid schedules never count as overdue.
 */
export function isScheduleOverdue(
  schedule: string,
  lastEndedAt: Date | null,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
  createdAt?: Date | null
): boolean {
  const interval = estimateCronIntervalMs(schedule, timeZone)
  if (interval == null) return false
  const last = lastEndedAt ?? createdAt ?? null
  if (!last) return false
  return now.getTime() > last.getTime() + interval + GRACE_MS
}
