import { errorSnippet } from "@/lib/backup/error-snippet"
import { getBackupStorageStats } from "@/lib/backup/storage-stats"
import { successRate as calcSuccessRate } from "@/lib/backup/success-rate"
import { buildUpcomingEntry } from "@/lib/cron/next"
import { db } from "@/lib/db"
import {
  backupConfigs,
  backupHistory,
  gitRepos,
  s3Profiles,
  servers,
} from "@/lib/db/schema"
import { getAppTimezone } from "@/lib/settings/timezone"
import { dateKeyInTimeZone, zonedDayStart } from "@/lib/backup/local-date"
import { and, desc, eq, gt, gte, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"


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

    const timeZone = await getAppTimezone()
    const todayKey = dateKeyInTimeZone(new Date(), timeZone)
    const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number)
    const dayKeys: string[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(
        Date.UTC(todayYear, todayMonth - 1, todayDay - (days - 1 - i))
      )
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, "0")
      const day = String(d.getUTCDate()).padStart(2, "0")
      dayKeys.push(`${y}-${m}-${day}`)
    }
    const since = zonedDayStart(dayKeys[0], timeZone)

    const [serverCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(servers)
    const [s3CountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(s3Profiles)
    const [gitCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(gitRepos)
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

    // A peer backup is `success` once staged locally; it is not off-site until
    // the friend ACKs. Keep those out of "delivered" success counts.
    const [waitingDeliveryRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backupHistory)
      .where(
        and(
          windowWhere,
          eq(backupHistory.status, "success"),
          eq(backupHistory.mailboxPending, true)
        )
      )
    const waitingDelivery = Number(waitingDeliveryRow?.count || 0)
    const deliveredSuccess = Math.max(0, statusCounts.success - waitingDelivery)

    const totalInWindow =
      statusCounts.running + statusCounts.success + statusCounts.failed
    const finishedInWindow = statusCounts.success + statusCounts.failed
    const successRate = calcSuccessRate(statusCounts.success, finishedInWindow)

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

    const byDay: Record<string, { success: number; failed: number; running: number }> = {}
    for (const key of dayKeys) {
      byDay[key] = { success: 0, failed: 0, running: 0 }
    }

    for (const row of historyRows) {
      const key = dateKeyInTimeZone(new Date(row.startTime), timeZone)
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

    const recentHistoryRows = await db.query.backupHistory.findMany({
      orderBy: [desc(backupHistory.startTime)],
      limit: 5,
      columns: {
        id: true,
        status: true,
        startTime: true,
        errorMessage: true,
        mailboxPending: true,
        artifactPath: true,
      },
      with: {
        backupConfig: {
          columns: { name: true, destinationKind: true },
        },
      },
    })
    const recentHistory = recentHistoryRows.map((row) => ({
      id: row.id,
      status: row.status,
      startTime: new Date(row.startTime).toISOString(),
      errorSnippet: errorSnippet(row.errorMessage),
      mailboxPending: row.mailboxPending,
      artifactPath: row.artifactPath,
      backupConfig: row.backupConfig
        ? { name: row.backupConfig.name, destinationKind: row.backupConfig.destinationKind }
        : null,
    }))

    const lastFailedRow = await db.query.backupHistory.findFirst({
      where: and(eq(backupHistory.status, "failed"), windowWhere),
      orderBy: [desc(backupHistory.startTime)],
      columns: {
        id: true,
        configId: true,
        startTime: true,
        errorMessage: true,
      },
      with: {
        backupConfig: {
          columns: { name: true },
        },
      },
    })
    let lastFailure: {
      id: string
      configId: string
      configName: string
      startTime: string
      errorSnippet: string | null
      resolved: boolean
      successesSince: number
    } | null = null
    if (lastFailedRow) {
      const [newerSuccess, [successCountRow]] = await Promise.all([
        db.query.backupHistory.findFirst({
          where: and(
            eq(backupHistory.configId, lastFailedRow.configId),
            eq(backupHistory.status, "success"),
            gt(backupHistory.startTime, lastFailedRow.startTime)
          ),
          columns: { id: true },
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(backupHistory)
          .where(
            and(
              eq(backupHistory.status, "success"),
              gt(backupHistory.startTime, lastFailedRow.startTime)
            )
          ),
      ])
      lastFailure = {
        id: lastFailedRow.id,
        configId: lastFailedRow.configId,
        configName: lastFailedRow.backupConfig?.name || "Unnamed Backup",
        startTime: new Date(lastFailedRow.startTime).toISOString(),
        errorSnippet: errorSnippet(lastFailedRow.errorMessage),
        resolved: Boolean(newerSuccess),
        successesSince: Number(successCountRow?.count || 0),
      }
    }

    const lastSuccessRow = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.status, "success"),
      orderBy: [desc(backupHistory.startTime)],
      columns: {
        id: true,
        configId: true,
        startTime: true,
      },
      with: {
        backupConfig: {
          columns: { name: true },
        },
      },
    })
    const lastSuccess = lastSuccessRow
      ? {
          id: lastSuccessRow.id,
          configId: lastSuccessRow.configId,
          configName: lastSuccessRow.backupConfig?.name || "Unnamed Backup",
          startTime: new Date(lastSuccessRow.startTime).toISOString(),
        }
      : null

    const storage = await getBackupStorageStats()

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
      gitRepos: Number(gitCountRow?.count || 0),
      backups: Number(backupCountRow?.count || 0),
      enabledBackups: Number(enabledCountRow?.count || 0),
      serverList,
      s3ProfileList,
      backupList,
      statusCounts,
      totalRuns: totalInWindow,
      successRate,
      waitingDelivery,
      deliveredSuccess,
      transferredBytes: Number(sizeAgg?.totalTransferred || 0),
      reportedBackupBytes: Number(sizeAgg?.totalSize || 0),
      avgBackupBytes: Math.round(Number(sizeAgg?.avgSize || 0)),
      daily,
      recentHistory,
      lastFailure,
      lastSuccess,
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
