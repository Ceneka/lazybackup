/** Compact human units for peer cards ("3.1 MB", "25 GB", "0 B"). */
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

export function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const decimals = unit === 0 || value >= 100 ? 0 : 1
  const text = value.toFixed(decimals).replace(/\.0$/, "")
  return `${text} ${UNITS[unit]}`
}

/** 0..100, never NaN, never above 100. */
export function percentUsed(usedBytes: number, quotaBytes: number): number {
  if (!Number.isFinite(usedBytes) || usedBytes <= 0) return 0
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return 0
  return Math.min(100, Math.max(0, (usedBytes / quotaBytes) * 100))
}
