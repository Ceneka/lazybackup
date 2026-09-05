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
