"use client"

import { BackupRecipesEmpty } from "@/components/backup-recipes-empty"
import { DashboardBackupStatus } from "@/components/dashboard-backup-status"
import { DashboardQuickActions } from "@/components/dashboard-quick-actions"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { QueryState } from "@/components/ui/query-state"
import { useDashboard, type DashboardLastFailure } from "@/lib/hooks/useDashboard"
import { useStatus } from "@/lib/hooks/useStatus"
import { cn, formatBytes } from "@/lib/utils"
import {
    CalendarClockIcon,
    CloudIcon,
    FolderIcon,
    HardDriveIcon,
    HistoryIcon,
    ServerIcon,
    ShieldAlertIcon,
    ShieldCheckIcon,
    ShieldIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

function DashboardStatusChip() {
  const status = useStatus()
  const overall = status.data?.summary.overall
  if (!overall) return null

  const label =
    overall === "ok" ? "OK" : overall === "warn" ? "Needs attention" : "Critical"
  const Icon =
    overall === "ok" ? ShieldCheckIcon : overall === "warn" ? ShieldIcon : ShieldAlertIcon

  return (
    <Link
      href="/status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80",
        overall === "ok" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        overall === "warn" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-300",
        overall === "critical" &&
          "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300"
      )}
      title={status.data?.summary.headline}
    >
      <Icon className="h-3.5 w-3.5" />
      Status: {label}
    </Link>
  )
}

function LastFailureCard({
  failure,
  isClient,
}: {
  failure: DashboardLastFailure
  isClient: boolean
}) {
  return (
    <Link
      href={`/history/${failure.id}`}
      className="block overflow-hidden rounded-lg border border-red-500/30 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">Last failure</p>
          <p className="truncate font-medium">{failure.configName}</p>
          {failure.errorSnippet ? (
            <p className="mt-1 line-clamp-2 break-all text-sm text-muted-foreground">
              {failure.errorSnippet}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {isClient ? new Date(failure.startTime).toLocaleString() : ""}
        </span>
      </div>
    </Link>
  )
}

export default function Dashboard() {
  const query = useDashboard(30)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return (
    <PageLayout>
      <PageHeader
        title="Dashboard"
        description="Last 30 days overview"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <DashboardStatusChip />
            <Link href="/servers" className="inline-flex items-center gap-1 hover:text-foreground">
              <ServerIcon className="h-3.5 w-3.5" />
              {query.data?.servers ?? "—"} servers
            </Link>
            <Link href="/s3-profiles" className="inline-flex items-center gap-1 hover:text-foreground">
              <CloudIcon className="h-3.5 w-3.5" />
              {query.data?.s3Profiles ?? "—"} S3
            </Link>
            <Link href="/backups" className="inline-flex items-center gap-1 hover:text-foreground">
              <FolderIcon className="h-3.5 w-3.5" />
              {query.data?.enabledBackups ?? "—"}/{query.data?.backups ?? "—"} backups enabled
            </Link>
          </div>
        }
      />

      <QueryState
        query={{
          isLoading: query.isLoading || (query.isPending && !query.data),
          isError: query.isError,
          error: query.error,
          data: query.data,
          refetch: query.refetch,
        }}
        dataLabel="dashboard"
        loadingComponent={
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border bg-card p-6 shadow"
              >
                <div className="mb-4 h-5 w-1/3 rounded bg-muted" />
                <div className="h-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        }
      >
        {query.data ? (
          <>
            {query.data.backups === 0 ? (
              <BackupRecipesEmpty />
            ) : (
              <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
              <DashboardBackupStatus
                days={query.data.days}
                totalRuns={query.data.totalRuns}
                successRate={query.data.successRate}
                statusCounts={query.data.statusCounts}
                daily={query.data.daily}
              />

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2">
                    <HardDriveIcon className="h-5 w-5" />
                    Storage
                  </CardTitle>
                  <CardDescription className="truncate" title={query.data.storage.path}>
                    {query.data.storage.path}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!query.data.storage.exists ? (
                    <p className="text-sm text-muted-foreground">
                      Backup storage path not found yet. It is created when the first backup runs.
                    </p>
                  ) : (
                    <>
                      <div>
                        <div className="text-3xl font-bold">{query.data.storage.totalSize}</div>
                        <div className="text-sm text-muted-foreground">Total on disk</div>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-md bg-muted/40 p-3">
                          <dt className="text-muted-foreground">Files</dt>
                          <dd className="text-lg font-semibold">{query.data.storage.fileCount}</dd>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3">
                          <dt className="text-muted-foreground">Folders</dt>
                          <dd className="text-lg font-semibold">
                            {query.data.storage.directoryCount}
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3">
                          <dt className="text-muted-foreground">Top-level entries</dt>
                          <dd className="text-lg font-semibold">
                            {query.data.storage.topLevelEntries}
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3">
                          <dt className="text-muted-foreground">Avg success size</dt>
                          <dd className="text-lg font-semibold">
                            {formatBytes(query.data.avgBackupBytes)}
                          </dd>
                        </div>
                      </dl>
                      {query.data.storage.latest && (
                        <p className="text-xs text-muted-foreground">
                          Newest file: {query.data.storage.latest.name} (
                          {query.data.storage.latest.size}
                          {isClient
                            ? `, ${new Date(query.data.storage.latest.mtime).toLocaleString()}`
                            : ""}
                          )
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {query.data.lastFailure ? (
              <LastFailureCard failure={query.data.lastFailure} isClient={isClient} />
            ) : null}
              </>
            )}

            <DashboardQuickActions
              servers={query.data.serverList ?? []}
              s3Profiles={query.data.s3ProfileList ?? []}
              backups={query.data.backupList ?? []}
            />

            {query.data.backups > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Recent Activity</h2>
                {query.data.recentHistory.length > 0 ? (
                  <div className="space-y-3">
                    {query.data.recentHistory.map((item) => (
                      <Link
                        href={`/history/${item.id}`}
                        key={item.id}
                        className="block min-w-0 overflow-hidden rounded-md p-3 transition-colors hover:bg-accent"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center space-x-2">
                            <div
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                item.status === "running"
                                  ? "bg-blue-500"
                                  : item.status === "success"
                                    ? "bg-green-500"
                                    : "bg-red-500"
                              }`}
                            />
                            <span className="truncate">
                              {item.backupConfig?.name || "Unnamed Backup"}
                            </span>
                          </div>
                          <span className="shrink-0 text-sm text-muted-foreground">
                            {isClient ? new Date(item.startTime).toLocaleString() : ""}
                          </span>
                        </div>
                        {item.status === "failed" && item.errorSnippet ? (
                          <p
                            className="mt-1 line-clamp-2 break-all pl-4 text-sm text-red-500"
                            title={item.errorSnippet}
                          >
                            {item.errorSnippet}
                          </p>
                        ) : null}
                      </Link>
                    ))}
                    <div className="mt-4 text-center">
                      <Link href="/history" className="text-sm text-blue-500 hover:underline">
                        View all activity
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-muted-foreground">
                    <HistoryIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p>No recent backup activity found</p>
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-1 text-xl font-semibold">Upcoming Backups</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Times in {query.data.timezone || "UTC"}
                </p>
                {(query.data.upcomingBackups?.length ?? 0) > 0 ? (
                  <div className="space-y-3">
                    {query.data.upcomingBackups.map((item) => (
                      <Link
                        href={`/backups/${item.id}`}
                        key={item.id}
                        className="block rounded-md p-3 transition-colors hover:bg-accent"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {item.scheduleLabel} ({item.schedule})
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-sm text-muted-foreground">
                            {item.nextRunFormatted || "—"}
                          </div>
                        </div>
                      </Link>
                    ))}
                    <div className="mt-4 text-center">
                      <Link href="/backups" className="text-sm text-blue-500 hover:underline">
                        View all backups
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center text-muted-foreground">
                    <CalendarClockIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p>No scheduled backups</p>
                  </div>
                )}
              </div>
            </div>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </PageLayout>
  )
}
