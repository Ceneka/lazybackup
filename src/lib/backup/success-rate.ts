/**
 * Percent of successful runs. Zero runs is 0 — not 100 — so empty
 * dashboards do not look like a perfect track record.
 */
export function successRate(success: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((success / total) * 100)
}
