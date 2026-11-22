/** Calendar day in the process local timezone, matching dashboard history buckets. */

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Inclusive local midnight → exclusive next midnight, or null if `dayKey` is not a real date. */
export function localDayRange(dayKey: string): { start: Date; end: Date } | null {
  const match = DAY_KEY_RE.exec(dayKey.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const start = new Date(y, m - 1, d)
  if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) {
    return null
  }
  return { start, end: new Date(y, m - 1, d + 1) }
}

/** Calendar day key (`YYYY-MM-DD`) in the configured app timezone. */
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value
    const year = get("year")
    const month = get("month")
    const day = get("day")
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // fall through to process-local time
  }
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Instant of local midnight for a `YYYY-MM-DD` key in `timeZone`. */
export function zonedDayStart(dayKey: string, timeZone: string): Date {
  const match = DAY_KEY_RE.exec(dayKey)
  if (!match) return new Date(0)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const utcMidnight = new Date(Date.UTC(y, m - 1, d))
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(utcMidnight)
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0)
    const asUTC = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    )
    return new Date(utcMidnight.getTime() - (asUTC - utcMidnight.getTime()))
  } catch {
    return utcMidnight
  }
}

/** Inclusive app-timezone midnight → exclusive next midnight, or null if `dayKey` is invalid. */
export function zonedDayRange(
  dayKey: string,
  timeZone: string
): { start: Date; end: Date } | null {
  const local = localDayRange(dayKey)
  if (!local) return null
  const [y, m, d] = dayKey.trim().split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
  return { start: zonedDayStart(dayKey.trim(), timeZone), end: zonedDayStart(nextKey, timeZone) }
}
