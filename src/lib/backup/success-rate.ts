/**
 * Percent of successful runs. Zero runs is 0 — not 100 — so empty
 * dashboards do not look like a perfect track record.
 *
 * Callers should pass finished runs (`success + failed`), not in-flight ones.
 * A run set with any failure never rounds up to 100%, so the headline number
 * cannot contradict the failure count next to it.
 */
export function successRate(success: number, total: number): number {
  if (total <= 0) return 0
  const rounded = Math.round((success / total) * 100)
  return success < total ? Math.min(99, rounded) : rounded
}
