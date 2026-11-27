"use client"

import { BackupRecipesEmpty } from "@/components/backup-recipes-empty"
import { DashboardBackupStatus } from "@/components/dashboard-backup-status"
import { DashboardFriendStorage } from "@/components/dashboard-friend-storage"
import { DashboardQuickActions } from "@/components/dashboard-quick-actions"
import { DeliveryBadge } from "@/components/peer/delivery-badge"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { deriveDeliveryState } from "@/lib/backup/delivery-state"
import { formatInTimezone } from "@/lib/cron/format"
import {
  useDashboard,
  useDashboardStorage,
  type DashboardLastFailure,
} from "@/lib/hooks/useDashboard"
import { usePeers } from "@/lib/hooks/usePeers"
import { useStatus } from "@/lib/hooks/useStatus"
import { peerIdFromArtifactPath, resolveFriendName } from "@/lib/peer/friend-copy"
import { cn, formatBytes } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CloudIcon,
  FolderIcon,
  GitBranchIcon,
  HardDriveIcon,
  HistoryIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from "lucide-react"
import Link from "next/link"

function DashboardStatusChip() {
  const status = useStatus()
  const overall = status.data?.summary.overall
  if (!overall) return null

  const label =
    overall === "ok" ? "OK" : overall === "warn" ? "Attention" : "Critical"
  const Icon =
    overall === "ok" ? ShieldCheckIcon : overall === "warn" ? ShieldIcon : ShieldAlertIcon

  return (
    <Link
      href="/status"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80",
        overall === "ok" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        overall === "warn" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-300",
        overall === "critical" &&
          "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300"
      )}
      title={status.data?.summary.headline}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </Link>
  )
}

function LastFailureCard({
  failure,
  timeZone,
}: {
  failure: DashboardLastFailure
  timeZone: string
}) {
  return (
    <Link
      href={`/history/${failure.id}`}
      className="block overflow-hidden rounded-lg border border-red-500/30 bg-red-500/5 p-4 transition-colors hover:bg-red-500/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Last failure ·{" "}
            {formatDistanceToNow(new Date(failure.startTime), { addSuffix: true })}
          </p>
          <p className="truncate font-medium">{failure.configName}</p>
          {failure.errorSnippet ? (
            <p className="mt-1 line-clamp-2 break-all text-sm text-muted-foreground">
              {failure.errorSnippet}
            </p>
          ) : null}
        </div>
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={formatInTimezone(new Date(failure.startTime), timeZone)}
        >
          {failure.successesSince > 0
            ? `${failure.successesSince} success${failure.successesSince === 1 ? "" : "es"} since`
            : formatInTimezone(new Date(failure.startTime), timeZone)}
        </span>
      </div>
    </Link>
  )
}

function DashboardStorageCard({
  avgBackupBytes,
  timeZone,
}: {
  avgBackupBytes: number
  timeZone: string
}) {
  const query = useDashboardStorage()
  const storage = query.data

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon aria-hidden="true" className="h-5 w-5" />
          <h2 className="text-base font-semibold">Storage</h2>
        </CardTitle>
        <CardDescription className="truncate" title={storage?.path}>
          {storage?.path ?? "Local backup storage"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!storage ? (
          query.isError ? (
            <p className="text-sm text-muted-foreground">
              Could not read backup storage.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => void query.refetch()}
              >
                Retry
              </button>
            </p>
          ) : (
            <div className="animate-pulse space-y-4" aria-label="Calculating storage usage">
              <div className="h-9 w-1/3 rounded bg-muted" />
              <div className="grid grid-cols-2 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 rounded-md bg-muted" />
                ))}
              </div>
            </div>
          )
        ) : !storage.exists ? (
          <p className="text-sm text-muted-foreground">
            Backup storage path not found yet. It is created when the first backup runs.
          </p>
        ) : (
          <>
            <div>
              <div className="text-3xl font-bold">{storage.totalSize}</div>
              <div className="text-sm text-muted-foreground">Total on disk</div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-muted-foreground">Files</dt>
                <dd className="text-lg font-semibold">{storage.fileCount}</dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-muted-foreground">Folders</dt>
                <dd className="text-lg font-semibold">{storage.directoryCount}</dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-muted-foreground">Top-level entries</dt>
                <dd className="text-lg font-semibold">{storage.topLevelEntries}</dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-muted-foreground">Avg success size</dt>
                <dd className="text-lg font-semibold">{formatBytes(avgBackupBytes)}</dd>
              </div>
            </dl>
            {storage.latest && (
              <p className="text-xs text-muted-foreground">
                Newest file: {storage.latest.name} ({storage.latest.size},{" "}
                {formatInTimezone(new Date(storage.latest.mtime), timeZone)})
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const query = useDashboard(30)
  const peersQuery = usePeers()
  const peers = peersQuery.data?.peers || []
  const status = useStatus()
  const data = query.data
  const overdue = status.data?.backups.overdueSchedules ?? null
  const runHref = data?.backupList[0] ? `/backups/${data.backupList[0].id}` : "/backups"

  return (
    <PageLayout>
      <PageHeader
        title="Dashboard"
        description="Last 30 days overview"
        actions={
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:w-auto sm:gap-x-3 sm:text-sm">
            <DashboardStatusChip />
            <Link href="/connections?tab=servers" className="inline-flex items-center gap-1 hover:text-foreground">
              <ServerIcon aria-hidden="true" className="h-3.5 w-3.5" />
              {data?.servers ?? "—"} {data?.servers === 1 ? "server" : "servers"}
            </Link>
            <Link href="/connections?tab=s3" className="inline-flex items-center gap-1 hover:text-foreground">
              <CloudIcon aria-hidden="true" className="h-3.5 w-3.5" />
              {data?.s3Profiles ?? "—"} S3 profiles
            </Link>
            <Link href="/connections?tab=git" className="inline-flex items-center gap-1 hover:text-foreground">
              <GitBranchIcon aria-hidden="true" className="h-3.5 w-3.5" />
              {data?.gitRepos ?? "—"} Git
            </Link>
            <Link href="/backups" className="inline-flex items-center gap-1 hover:text-foreground">
              <FolderIcon aria-hidden="true" className="h-3.5 w-3.5" />
              {data?.enabledBackups ?? "—"}/{data?.backups ?? "—"}{" "}
              <span className="sm:hidden">backups</span>
              <span className="hidden sm:inline">backups enabled</span>
            </Link>
            {query.dataUpdatedAt ? (
              <span className="hidden text-xs text-muted-foreground md:inline">
                Updated{" "}
                {formatDistanceToNow(new Date(query.dataUpdatedAt), {
                  addSuffix: true,
                })}
              </span>
            ) : null}
            <LoadingButton
              isLoading={query.isFetching}
              onClick={() => void query.refetch()}
              variant="outline"
              size="icon"
              hideTextWhenLoading={true}
              aria-label="Refresh dashboard"
            >
              <RefreshCwIcon aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">Refresh dashboard</span>
            </LoadingButton>
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
        {data ? (
          <>
            {data.backups === 0 ? (
              <BackupRecipesEmpty />
            ) : (
              <>
                {data.enabledBackups === 0 ? (
                  <div
                    role="status"
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                  >
                    <AlertTriangleIcon
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                    />
                    <span className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
                      All {data.backups} backup{data.backups === 1 ? "" : "s"} are
                      disabled — nothing will run on schedule.
                    </span>
                    <Link
                      href="/backups"
                      className="font-medium text-amber-900 underline underline-offset-2 hover:no-underline dark:text-amber-200"
                    >
                      Manage backups
                    </Link>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                  <DashboardBackupStatus
                    days={data.days}
                    totalRuns={data.totalRuns}
                    successRate={data.successRate}
                    statusCounts={data.statusCounts}
                    daily={data.daily}
                    lastSuccess={data.lastSuccess}
                    overdue={overdue}
                    timeZone={data.timezone}
                  />

                  <DashboardStorageCard
                    avgBackupBytes={data.avgBackupBytes}
                    timeZone={data.timezone}
                  />
                </div>

                {data.lastFailure && !data.lastFailure.resolved ? (
                  <LastFailureCard failure={data.lastFailure} timeZone={data.timezone} />
                ) : null}
              </>
            )}

            <DashboardFriendStorage />

            {data.backups > 0 ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle>
                      <h2 className="text-base font-semibold">Recent Activity</h2>
                    </CardTitle>
                    <CardDescription>
                      Latest runs · times in {data.timezone || "UTC"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {data.recentHistory.length > 0 ? (
                      <div className="space-y-3">
                        {data.recentHistory.map((item) => {
                          const deliveryState = deriveDeliveryState({
                            status: item.status,
                            deliveryState: item.deliveryState,
                            mailboxPending: item.mailboxPending,
                            artifactPath: item.artifactPath,
                            destinationKind: item.backupConfig?.destinationKind,
                          })
                          const friendName = resolveFriendName(
                            peers,
                            peerIdFromArtifactPath(item.artifactPath)
                          )
                          return (
                          <Link
                            href={`/history/${item.id}`}
                            key={item.id}
                            className="block min-w-0 overflow-hidden rounded-md p-3 transition-colors hover:bg-accent"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                {deliveryState ? (
                                  <DeliveryBadge
                                    state={deliveryState}
                                    friendName={friendName}
                                  />
                                ) : (
                                  <Badge
                                    variant={
                                      item.status === "success"
                                        ? "success"
                                        : item.status === "running"
                                          ? "info"
                                          : item.status === "failed"
                                            ? "destructive"
                                            : "muted"
                                    }
                                  >
                                    {item.status}
                                  </Badge>
                                )}
                                <span className="truncate">
                                  {item.backupConfig?.name || "Unnamed Backup"}
                                </span>
                              </div>
                              <span
                                className="shrink-0 text-xs text-muted-foreground"
                                title={formatInTimezone(
                                  new Date(item.startTime),
                                  data.timezone
                                )}
                              >
                                {formatInTimezone(new Date(item.startTime), data.timezone, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            {item.status === "failed" && item.errorSnippet ? (
                              <p
                                className="mt-1 line-clamp-2 break-all pl-1 text-sm text-destructive"
                                title={item.errorSnippet}
                              >
                                {item.errorSnippet}
                              </p>
                            ) : null}
                            {deliveryState === "waiting" ? (
                              <p className="mt-1 pl-1 text-xs text-amber-700 dark:text-amber-400">
                                Saved on this server — not yet on {friendName}&apos;s disk.
                              </p>
                            ) : null}
                          </Link>
                          )
                        })}
                        <div className="mt-4 text-center">
                          <Link
                            href="/history"
                            className="text-sm text-blue-700 hover:underline dark:text-blue-400"
                          >
                            View all activity
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="py-6 text-center text-muted-foreground">
                        <HistoryIcon
                          aria-hidden="true"
                          className="mx-auto mb-2 h-8 w-8 opacity-50"
                        />
                        <p>No recent backup activity found</p>
                        <p className="mt-1 text-sm">
                          Nothing has run in the last {data.days} days.
                        </p>
                        <Button variant="outline" size="sm" className="mt-3" asChild>
                          <Link href={runHref}>
                            <PlayIcon aria-hidden="true" className="h-4 w-4" />
                            Run a backup
                          </Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle>
                      <h2 className="text-base font-semibold">Upcoming Backups</h2>
                    </CardTitle>
                    <CardDescription>
                      Times in {data.timezone || "UTC"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(data.upcomingBackups?.length ?? 0) > 0 ? (
                      <div className="space-y-3">
                        {data.upcomingBackups.map((item) => (
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
                          <Link
                            href="/backups"
                            className="text-sm text-blue-700 hover:underline dark:text-blue-400"
                          >
                            View all backups
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="py-6 text-center text-muted-foreground">
                        <CalendarClockIcon
                          aria-hidden="true"
                          className="mx-auto mb-2 h-8 w-8 opacity-50"
                        />
                        <p>No scheduled backups</p>
                        <p className="mt-1 text-sm">
                          Enable a backup or add a schedule to see it here.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            <DashboardQuickActions
              servers={data.serverList ?? []}
              s3Profiles={data.s3ProfileList ?? []}
              backups={data.backupList ?? []}
            />
          </>
        ) : null}
      </QueryState>
    </PageLayout>
  )
}
