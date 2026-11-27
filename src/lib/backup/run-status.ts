/**
 * Client-safe helpers for backup run health (list cards, detail banner).
 * Keep this module free of Node-only imports so it can be used in
 * client components.
 */

import { errorSnippet } from './error-snippet'
import { selectStaleRunningIds } from './stale-running'

export type BackupRunStatus = 'running' | 'success' | 'failed'

/** Compact latest-history projection returned by the backup APIs. */
export type LatestRunSummary = {
  id: string
  status: BackupRunStatus
  startTime: string
  endTime: string | null
  errorSnippet: string | null
}

export function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    // unix seconds vs milliseconds
    return new Date(value < 1e12 ? value * 1000 : value)
  }
  return new Date(value)
}

/** History row shape accepted by `toLatestRunSummary`. */
export type HistoryRunRow = {
  id: string
  status: BackupRunStatus
  startTime: Date | string | number
  endTime?: Date | string | number | null
  errorMessage?: string | null
}

export function toLatestRunSummary(row: HistoryRunRow): LatestRunSummary {
  return {
    id: row.id,
    status: row.status,
    startTime: toDate(row.startTime).toISOString(),
    endTime: row.endTime ? toDate(row.endTime).toISOString() : null,
    errorSnippet: errorSnippet(row.errorMessage),
  }
}

/**
 * Newest non-stale `running` row, or null. Mirrors the server's
 * `findActiveRunningEntry` so a crashed run does not block the Run button
 * forever. Rows may come straight from `/api/history`.
 */
export function pickActiveRunningRun<
  T extends { id: string; status: string; startTime: Date | string | number },
>(rows: readonly T[], now: Date = new Date()): T | null {
  const stale = new Set(selectStaleRunningIds(rows, now))
  let best: T | null = null
  let bestMs = -1

  for (const row of rows) {
    if (row.status !== 'running' || stale.has(row.id)) continue
    const started = toDate(row.startTime).getTime()
    if (Number.isNaN(started) || started < bestMs) continue
    best = row
    bestMs = started
  }

  return best
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Short relative time for run/next-run labels: `just now`, `5m ago`,
 * `2h ago`, `3d ago`, or `in 4h` for future timestamps. Older than a year
 * falls back to years so labels stay short.
 */
export function formatRelativeTime(
  value: Date | string | number,
  now: Date = new Date()
): string {
  const time = toDate(value).getTime()
  if (!Number.isFinite(time)) return '—'

  const diff = now.getTime() - time
  const absolute = Math.abs(diff)

  if (absolute < 10_000) return 'just now'

  let amount: string
  if (absolute < MINUTE) {
    amount = `${Math.floor(absolute / 1000)}s`
  } else if (absolute < HOUR) {
    amount = `${Math.floor(absolute / MINUTE)}m`
  } else if (absolute < DAY) {
    amount = `${Math.floor(absolute / HOUR)}h`
  } else if (absolute < 30 * DAY) {
    amount = `${Math.floor(absolute / DAY)}d`
  } else if (absolute < 365 * DAY) {
    amount = `${Math.floor(absolute / (30 * DAY))}mo`
  } else {
    amount = `${Math.floor(absolute / (365 * DAY))}y`
  }

  return diff >= 0 ? `${amount} ago` : `in ${amount}`
}
