import { getBackupStorageStats } from "@/lib/backup/storage-stats"
import { buildUpcomingEntry } from "@/lib/cron/next"
import { db } from "@/lib/db"
import { backupConfigs, backupHistory, s3Profiles, servers } from "@/lib/db/schema"
import { getAppTimezone } from "@/lib/settings/timezone"
import { and, desc, eq, gte, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * GET /api/dashboard - Aggregated dashboard data (default: last 30 days)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const days = Math.min(
      365,
      Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30)
    )

    const since = new Date()
    since.setHours(0, 0, 0, 0)
    since.setDate(since.getDate() - (days - 1))

    const [serverCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(servers)
    const [s3CountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(s3Profiles)
    const [backupCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backupConfigs)
    const [enabledCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backupConfigs)
      .where(sql`${backupConfigs.enabled} = 1`)

    const serverList = await db
      .select({
        id: servers.id,
        name: servers.name,
        host: servers.host,
        port: servers.port,
      })
      .from(servers)
      .orderBy(servers.name)
    const s3ProfileList = (
      await db
        .select({
          id: s3Profiles.id,
          name: s3Profiles.name,
          bucket: s3Profiles.bucket,
          endpoint: s3Profiles.endpoint,
        })
        .from(s3Profiles)
        .orderBy(s3Profiles.name)
    ).map((row) => ({ ...row, bucket: row.bucket.trim() }))
    const backupList = await db
      .select({
        id: backupConfigs.id,
        name: backupConfigs.name,
        enabled: backupConfigs.enabled,
      })
      .from(backupConfigs)
      .orderBy(backupConfigs.name)

    const windowWhere = gte(backupHistory.startTime, since)

    const statusCountsQuery = await db
      .select({
        status: backupHistory.status,
        count: sql<number>`count(*)`,
      })
      .from(backupHistory)
      .where(windowWhere)
      .groupBy(backupHistory.status)

    const statusCounts = statusCountsQuery.reduce(
      (acc, { status, count }) => {
        acc[status as keyof typeof acc] = Number(count)
        return acc
      },
      { running: 0, success: 0, failed: 0 }
    )

    const totalInWindow =
      statusCounts.running + statusCounts.success + statusCounts.failed
    const successRate =
      totalInWindow > 0
        ? Math.round((statusCounts.success / totalInWindow) * 100)
        : 100

    const [sizeAgg] = await db
      .select({
        totalTransferred: sql<number>`coalesce(sum(${backupHistory.transferredSize}), 0)`,
        totalSize: sql<number>`coalesce(sum(${backupHistory.totalSize}), 0)`,
        avgSize: sql<number>`coalesce(avg(${backupHistory.totalSize}), 0)`,
      })
      .from(backupHistory)
      .where(and(windowWhere, sql`${backupHistory.status} = 'success'`))

    const historyRows = await db
      .select({
        status: backupHistory.status,
        startTime: backupHistory.startTime,
      })
      .from(backupHistory)
      .where(windowWhere)
      .orderBy(backupHistory.startTime)

    const dayKeys: string[] = []
    const byDay: Record<string, { success: number; failed: number; running: number }> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setDate(since.getDate() + i)
      const key = toLocalDateKey(d)
      dayKeys.push(key)
      byDay[key] = { success: 0, failed: 0, running: 0 }
    }

    for (const row of historyRows) {
      const key = toLocalDateKey(new Date(row.startTime))
      if (!byDay[key]) continue
      if (row.status === "success" || row.status === "failed" || row.status === "running") {
        byDay[key][row.status] += 1
      }
    }

    const daily = dayKeys.map((date) => ({
      date,
      ...byDay[date],
      total: byDay[date].success + byDay[date].failed + byDay[date].running,
    }))

    const recentHistory = await db.query.backupHistory.findMany({
      orderBy: [desc(backupHistory.startTime)],
      limit: 5,
      with: {
        backupConfig: {
          with: { server: true, destinationServer: true, sourceS3Profile: true, destinationS3Profile: true },
        },
      },
    })

    const storage = await getBackupStorageStats()

    const timeZone = await getAppTimezone()
    const enabledConfigs = await db.query.backupConfigs.findMany({
      where: eq(backupConfigs.enabled, true),
      with: { server: true, destinationServer: true, sourceS3Profile: true, destinationS3Profile: true },
    })
    const upcomingBackups = enabledConfigs
      .map((config) => buildUpcomingEntry(config, timeZone))
      .filter((entry) => entry.nextRun)
      .sort((a, b) => {
        if (!a.nextRun || !b.nextRun) return 0
        return a.nextRun.localeCompare(b.nextRun)
      })
      .slice(0, 8)

    return NextResponse.json({
      days,
      since: since.toISOString(),
      servers: Number(serverCountRow?.count || 0),
      s3Profiles: Number(s3CountRow?.count || 0),
      backups: Number(backupCountRow?.count || 0),
      enabledBackups: Number(enabledCountRow?.count || 0),
      serverList,
      s3ProfileList,
      backupList,
      statusCounts,
      totalRuns: totalInWindow,
      successRate,
      transferredBytes: Number(sizeAgg?.totalTransferred || 0),
      reportedBackupBytes: Number(sizeAgg?.totalSize || 0),
      avgBackupBytes: Math.round(Number(sizeAgg?.avgSize || 0)),
      daily,
      recentHistory,
      storage,
      timezone: timeZone,
      upcomingBackups,
    })
  } catch (error) {
    console.error("Error fetching dashboard data:", error)
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    )
  }
}
