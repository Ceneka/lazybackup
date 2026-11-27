import { db } from '@/lib/db'
import { backupHistory } from '@/lib/db/schema'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { toLatestRunSummary, type LatestRunSummary } from './run-status'

const latestRunColumns = {
  id: true,
  configId: true,
  status: true,
  startTime: true,
  endTime: true,
  errorMessage: true,
} as const

/** Latest history row for one backup config (list + detail API projections). */
export async function getLatestRun(configId: string): Promise<LatestRunSummary | null> {
  const row = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.configId, configId),
    orderBy: [desc(backupHistory.startTime)],
    columns: latestRunColumns,
  })
  return row ? toLatestRunSummary(row) : null
}

/**
 * Latest history row per config in one query (window function CTE), so the
 * backups list does not run one query per card.
 */
export async function listLatestRunsByConfig(
  configIds?: readonly string[]
): Promise<Map<string, LatestRunSummary>> {
  const runs = new Map<string, LatestRunSummary>()
  if (configIds && configIds.length === 0) return runs

  const ranked = db.$with('ranked_backup_history').as(
    db
      .select({
        id: backupHistory.id,
        configId: backupHistory.configId,
        status: backupHistory.status,
        startTime: backupHistory.startTime,
        endTime: backupHistory.endTime,
        errorMessage: backupHistory.errorMessage,
        rank: sql<number>`row_number() over (
          partition by ${backupHistory.configId}
          order by ${backupHistory.startTime} desc
        )`.as('rank'),
      })
      .from(backupHistory)
      .where(configIds ? inArray(backupHistory.configId, [...configIds]) : undefined)
  )

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      configId: ranked.configId,
      status: ranked.status,
      startTime: ranked.startTime,
      endTime: ranked.endTime,
      errorMessage: ranked.errorMessage,
    })
    .from(ranked)
    .where(eq(ranked.rank, 1))

  for (const row of rows) {
    runs.set(row.configId, toLatestRunSummary(row))
  }
  return runs
}
