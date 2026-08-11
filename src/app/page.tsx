"use client"

import { PageHeader, PageLayout } from "@/components/page-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { QueryState } from "@/components/ui/query-state"
import { useDashboard } from "@/lib/hooks/useDashboard"
import { formatBytes } from "@/lib/utils"
import {
  CheckCircleIcon,
  CalendarClockIcon,
  CloudIcon,
  FolderIcon,
  HardDriveIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  ServerIcon,
  XCircleIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

function Last30DaysChart({
  daily,
}: {
  daily: Array<{
    date: string
    success: number
    failed: number
    running: number
    total: number
  }>
}) {
  const max = Math.max(1, ...daily.map((d) => d.total))
  const hasAny = daily.some((d) => d.total > 0)

  if (!hasAny) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground">No backup runs in the last 30 days</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex h-36 items-end gap-0.5">
        {daily.map((day) => {
          const px = day.total === 0 ? 3 : Math.max(10, Math.round((day.total / max) * 140))
          const title = `${day.date}: ${day.success} ok, ${day.failed} failed, ${day.running} running`
          return (
            <div key={day.date} className="flex flex-1 flex-col justify-end" title={title}>
              <div
                className="mx-auto flex w-full max-w-[10px] flex-col justify-end overflow-hidden rounded-t-sm"
                style={{ height: `${px}px` }}
              >
                {day.failed > 0 && (
                  <div className="w-full bg-red-500" style={{ flex: day.failed }} />
                )}
                {day.running > 0 && (
                  <div className="w-full bg-blue-500" style={{ flex: day.running }} />
                )}
                {day.success > 0 && (
                  <div className="w-full bg-green-500" style={{ flex: day.success }} />
                )}
                {day.total === 0 && <div className="w-full flex-1 bg-muted" />}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{daily[0]?.date}</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
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
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
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
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle>Backup status</CardTitle>
                  <CardDescription>
                    {query.data.totalRuns} run{query.data.totalRuns === 1 ? "" : "s"} in the last{" "}
                    {query.data.days} days
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="text-4xl font-bold tracking-tight">
                        {query.data.successRate}%
                      </div>
                      <div className="text-sm text-muted-foreground">Success rate</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Link
                        href="/history?status=running"
                        className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
                        title="View running backups"
                      >
                        <PlayIcon className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-blue-500">
                          {query.data.statusCounts.running}
                        </span>
                      </Link>
                      <Link
                        href="/history?status=success"
                        className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
                        title="View successful backups"
                      >
                        <CheckCircleIcon className="h-4 w-4 text-green-500" />
                        <span className="font-medium text-green-500">
                          {query.data.statusCounts.success}
                        </span>
                      </Link>
                      <Link
                        href="/history?status=failed"
                        className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
                        title="View failed backups"
                      >
                        <XCircleIcon className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-red-500">
                          {query.data.statusCounts.failed}
                        </span>
                      </Link>
                    </div>
                  </div>
                  <Progress value={query.data.successRate} className="h-2" />
                  <Last30DaysChart daily={query.data.daily} />
                  <div className="text-right">
                    <Link href="/history" className="text-sm text-blue-500 hover:underline">
                      View all history
                    </Link>
                  </div>
                </CardContent>
              </Card>

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

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Quick Actions</h2>
                <div className="space-y-4">
                  <Link
                    href="/servers/new"
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <PlusIcon className="h-5 w-5" />
                    <span>Add New Server</span>
                  </Link>
                  <Link
                    href="/s3-profiles/new"
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <PlusIcon className="h-5 w-5" />
                    <span>Add S3 Profile</span>
                  </Link>
                  <Link
                    href="/backups/new"
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <PlusIcon className="h-5 w-5" />
                    <span>Create New Backup</span>
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Recent Activity</h2>
                {query.data.recentHistory.length > 0 ? (
                  <div className="space-y-3">
                    {query.data.recentHistory.map((item: any) => (
                      <Link
                        href={`/history/${item.id}`}
                        key={item.id}
                        className="block rounded-md p-3 transition-colors hover:bg-accent"
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
                        {item.status === "failed" && item.errorMessage && (
                          <p className="mt-1 pl-4 text-sm text-red-500">
                            Error: {item.errorMessage}
                          </p>
                        )}
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

              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow md:col-span-2 lg:col-span-1">
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
          </>
        ) : null}
      </QueryState>
    </PageLayout>
  )
}
