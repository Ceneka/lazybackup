/**
 * Format a duration in milliseconds for compact UI labels.
 *
 * - below a minute: one decimal second, e.g. `4.2s` (whole seconds drop `.0`)
 * - below an hour: `12m 04s`
 * - an hour or more: `1h 02m 13s`
 *
 * Non-finite or negative values format as `0s`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"

  const seconds = ms / 1000

  // Keep sub-minute values readable with one decimal (e.g. 4.2s). Values that
  // round up to a full minute fall through to the minute formatter.
  if (seconds < 59.95) {
    const rounded = Math.round(seconds * 10) / 10
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`
  }

  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainder = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${pad2(minutes)}m ${pad2(remainder)}s`
  }
  return `${minutes}m ${pad2(remainder)}s`
}

const countFormatter = new Intl.NumberFormat("en-US")

/**
 * Group a count for UI labels (`1234567` -> `1,234,567`).
 *
 * Fixed `en-US` locale so server and client render identical markup.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0"
  return countFormatter.format(value)
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}
