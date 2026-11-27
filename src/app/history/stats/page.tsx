"use client"

import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { QueryState } from "@/components/ui/query-state"
import { successRate as calcSuccessRate } from "@/lib/backup/success-rate"
import { formatCount, formatDuration } from "@/lib/format/duration"
import { useHistoryStats } from "@/lib/hooks/useHistory"
import { cn, formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import {
    ArrowLeftIcon,
    CheckCircleIcon,
    ClockIcon,
    FileIcon,
    HardDriveIcon,
    HistoryIcon,
    PlayIcon,
    XCircleIcon
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

type ChartPoint = {
  id: string
  status: string
  startTime: string
  endTime?: string | null
}

export default function HistoryStatsPage() {
  const router = useRouter()
  const query = useHistoryStats()

  const statusCounts = query.data?.statusCounts ?? {}
  const successCount = Number(statusCounts.success || 0)
  const failedCount = Number(statusCounts.failed || 0)
  const runningCount = Number(statusCounts.running || 0)
  const finishedCount = successCount + failedCount
  const rate =
    finishedCount > 0 ? calcSuccessRate(successCount, finishedCount) : null
  const totalBackups = Number(query.data?.totalBackups || 0)
  const avgSize = Number(query.data?.avgSize || 0)
  const chart: ChartPoint[] = Array.isArray(query.data?.chartHistory)
    ? (query.data.chartHistory as ChartPoint[])
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/history")}
          aria-label="Back to history"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to history</span>
        </Button>
        <h1 className="text-3xl font-bold">Backup Statistics</h1>
      </div>

      <QueryState
        query={query}
        dataLabel="statistics"
        errorIcon={<HistoryIcon className="h-12 w-12 text-red-500" />}
      >
        {query.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Backups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{formatCount(totalBackups)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Success Rate
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rate == null ? (
                    <>
                      <div className="text-3xl font-bold text-muted-foreground">—</div>
                      <p className="text-sm text-muted-foreground">
                        No finished runs yet
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-bold">{rate}%</div>
                      <Progress value={rate} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {formatCount(successCount)} of {formatCount(finishedCount)} finished runs
                        {runningCount > 0
                          ? ` · ${formatCount(runningCount)} running excluded`
                          : ""}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg. Backup Size
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {totalBackups > 0 && avgSize > 0 ? formatBytes(avgSize) : "—"}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Backup Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon className="h-4 w-4 text-green-500" />
                      <span>Success</span>
                    </div>
                    <span className="font-medium">{formatCount(successCount)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <PlayIcon className="h-4 w-4 text-blue-500" />
                      <span>Running</span>
                    </div>
                    <span className="font-medium">{formatCount(runningCount)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                      <span>Failed</span>
                    </div>
                    <span className="font-medium">{formatCount(failedCount)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {chart.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Runs</CardTitle>
                  <CardDescription>
                    Last {chart.length} runs, oldest to newest. Each bar links to
                    the run and is labelled with its exact time and status.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol
                    className="flex flex-wrap items-end gap-1.5"
                    aria-label="Recent backup outcomes, oldest to newest"
                  >
                    {chart.map((point) => {
                      const label =
                        point.status === "success"
                          ? "success"
                          : point.status === "failed"
                            ? "failed"
                            : "running"
                      return (
                        <li key={point.id}>
                          <Link
                            href={`/history/${point.id}`}
                            title={`${format(new Date(point.startTime), "PPpp")} — ${label}`}
                            className={cn(
                              "flex h-8 w-6 items-center justify-center rounded-sm text-[10px] font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              point.status === "success"
                                ? "bg-emerald-600 text-white"
                                : point.status === "failed"
                                  ? "bg-red-600 text-white"
                                  : "bg-sky-600 text-white"
                            )}
                          >
                            <span className="sr-only">
                              {format(new Date(point.startTime), "PPpp")}: {label}
                            </span>
                            <span aria-hidden>
                              {point.status === "success"
                                ? "✓"
                                : point.status === "failed"
                                  ? "✕"
                                  : "…"}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm bg-emerald-600" aria-hidden />
                      Success
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm bg-red-600" aria-hidden />
                      Failed
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm bg-sky-600" aria-hidden />
                      Running
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {query.data?.recentBackup && (
              <Card>
                <CardHeader>
                  <CardTitle>Most Recent Successful Backup</CardTitle>
                  <CardDescription>
                    {query.data.recentBackup.endTime && (
                      <>Completed on {format(new Date(query.data.recentBackup.endTime), "PPP 'at' p")}</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Backup Configuration
                      </div>
                      <div>
                        <Link
                          href={`/backups/${query.data.recentBackup.configId}`}
                          className="font-medium hover:underline text-primary"
                        >
                          {query.data.recentBackup.configName}
                        </Link>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <ClockIcon className="w-4 h-4 mr-2" />
                        Window
                      </div>
                      <div>
                        {query.data.recentBackup.startTime && query.data.recentBackup.endTime ? (
                          <>
                            {format(new Date(query.data.recentBackup.startTime), "p")} –{" "}
                            {format(new Date(query.data.recentBackup.endTime), "p")}
                            <div className="text-xs text-muted-foreground">
                              {formatDuration(
                                new Date(query.data.recentBackup.endTime).getTime() -
                                  new Date(query.data.recentBackup.startTime).getTime()
                              )}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Files
                      </div>
                      <div>
                        {query.data.recentBackup.fileCount != null
                          ? formatCount(query.data.recentBackup.fileCount)
                          : "—"}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <HardDriveIcon className="w-4 h-4 mr-2" />
                        Size
                      </div>
                      <div>
                        {query.data.recentBackup.totalSize != null
                          ? formatBytes(query.data.recentBackup.totalSize)
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Button
                      size="sm"
                      onClick={() => router.push(`/history/${query.data.recentBackup.id}`)}
                      variant="outline"
                    >
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </QueryState>
    </div>
  )
}
