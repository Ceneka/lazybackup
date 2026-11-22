"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { localDayRange } from "@/lib/backup/local-date"
import { successRate as calcSuccessRate } from "@/lib/backup/success-rate"
import { formatInTimezone } from "@/lib/cron/format"
import type { DashboardDaily, DashboardLastSuccess } from "@/lib/hooks/useDashboard"
import { cn } from "@/lib/utils"
import { format, formatDistanceToNow } from "date-fns"
import { CheckCircleIcon, PlayIcon, XCircleIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

function historyHref(day: string | null, status?: "running" | "success" | "failed") {
  const params = new URLSearchParams()
  if (day) params.set("day", day)
  if (status) params.set("status", status)
  const qs = params.toString()
  return qs ? `/history?${qs}` : "/history"
}

function formatDay(dateKey: string, pattern: string) {
  const range = localDayRange(dateKey)
  return range ? format(range.start, pattern) : dateKey
}

function DayChart({
  daily,
  selectedDate,
  hoveredDate,
  onSelect,
  onHover,
}: {
  daily: DashboardDaily[]
  selectedDate: string | null
  hoveredDate: string | null
  onSelect: (date: string) => void
  onHover: (date: string | null) => void
}) {
  const max = Math.max(1, ...daily.map((d) => d.total))
  const hasAny = daily.some((d) => d.total > 0)
  const tipDate = hoveredDate ?? selectedDate
  const tipIndex = tipDate ? daily.findIndex((d) => d.date === tipDate) : -1
  const tip = tipIndex >= 0 ? daily[tipIndex] : null

  if (!hasAny) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground">No backup runs in the last 30 days</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative pt-16">
        {tip ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[16rem] rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={
              tipIndex <= 1
                ? { left: 0 }
                : tipIndex >= daily.length - 2
                  ? { right: 0 }
                  : {
                      left: `${((tipIndex + 0.5) / daily.length) * 100}%`,
                      transform: "translateX(-50%)",
                    }
            }
          >
            <p className="font-medium">{formatDay(tip.date, "EEE, MMM d")}</p>
            {tip.total === 0 ? (
              <p className="text-muted-foreground">No runs</p>
            ) : (
              <p className="text-muted-foreground">
                {tip.success} ok · {tip.failed} failed
                {tip.running > 0 ? ` · ${tip.running} running` : ""}
                {tip.success + tip.failed > 0
                  ? ` · ${calcSuccessRate(tip.success, tip.success + tip.failed)}%`
                  : ""}
              </p>
            )}
          </div>
        ) : null}
        <div className="-mx-1 overflow-x-auto pb-1">
          <div
            role="group"
            aria-label="Daily backup runs"
            className="flex h-36 min-w-[600px] items-end gap-px sm:min-w-0"
            onMouseLeave={() => onHover(null)}
          >
            {daily.map((day) => {
              const px = day.total === 0 ? 3 : Math.max(10, Math.round((day.total / max) * 140))
              const isSelected = selectedDate === day.date
              const isHovered = hoveredDate === day.date
              return (
                <button
                  key={day.date}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${formatDay(day.date, "MMMM d, yyyy")}: ${day.success} ok, ${day.failed} failed, ${day.running} running`}
                  onClick={() => onSelect(day.date)}
                  onMouseEnter={() => onHover(day.date)}
                  onFocus={() => onHover(day.date)}
                  onBlur={() => onHover(null)}
                  className={cn(
                    "flex min-w-6 flex-1 cursor-pointer touch-manipulation flex-col items-center justify-end rounded-sm py-0.5 outline-none transition-colors",
                    "hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60",
                    isSelected && "bg-muted",
                    isHovered && !isSelected && "bg-muted/50"
                  )}
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      "mx-auto flex w-full max-w-[10px] flex-col justify-end overflow-hidden rounded-t-sm",
                      isSelected && "ring-2 ring-foreground/80 ring-offset-1 ring-offset-background"
                    )}
                    style={{ height: `${px}px` }}
                  >
                    {day.failed > 0 && (
                      <div className="w-full bg-red-500" style={{ flex: day.failed }} />
                    )}
                    {day.running > 0 && (
                      <div className="w-full bg-blue-500" style={{ flex: day.running }} />
                    )}
                    {day.success > 0 && (
                      <div className="w-full bg-emerald-500" style={{ flex: day.success }} />
                    )}
                    {day.total === 0 && <div className="w-full flex-1 bg-muted-foreground/25" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDay(daily[0]?.date ?? "", "MMM d")}</span>
        <span>{formatDay(daily[daily.length - 1]?.date ?? "", "MMM d")}</span>
      </div>
    </div>
  )
}

export function DashboardBackupStatus({
  days,
  totalRuns,
  successRate,
  statusCounts,
  daily,
  lastSuccess,
  overdue,
  timeZone,
}: {
  days: number
  totalRuns: number
  successRate: number
  statusCounts: { running: number; success: number; failed: number }
  daily: DashboardDaily[]
  lastSuccess: DashboardLastSuccess | null
  overdue: { id: string; name: string }[] | null
  timeZone: string
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)

  const selected = daily.find((d) => d.date === selectedDate) ?? null
  const view = selected
    ? {
        running: selected.running,
        success: selected.success,
        failed: selected.failed,
        total: selected.total,
        finished: selected.success + selected.failed,
        rate:
          selected.success + selected.failed === 0
            ? null
            : calcSuccessRate(selected.success, selected.success + selected.failed),
      }
    : {
        running: statusCounts.running,
        success: statusCounts.success,
        failed: statusCounts.failed,
        total: totalRuns,
        finished: statusCounts.success + statusCounts.failed,
        rate: statusCounts.success + statusCounts.failed === 0 ? null : successRate,
      }

  const hasChartData = daily.some((d) => d.total > 0)
  const rateTone =
    view.failed === 0
      ? "text-emerald-700 dark:text-emerald-400"
      : view.rate === 0
        ? "text-destructive"
        : "text-amber-700 dark:text-amber-400"
  const barTone =
    view.failed === 0
      ? ""
      : view.rate === 0
        ? "[&>[data-slot=progress-indicator]]:bg-destructive"
        : "[&>[data-slot=progress-indicator]]:bg-amber-500"

  const toggleDay = (date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date))
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>
          <h2 className="text-base font-semibold">Backup status</h2>
        </CardTitle>
        <CardDescription>
          {selected ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {view.total} run{view.total === 1 ? "" : "s"} on{" "}
                {formatDay(selected.date, "EEE, MMM d")}
              </span>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="text-blue-700 hover:underline dark:text-blue-400"
              >
                Show last {days} days
              </button>
            </span>
          ) : (
            <>
              {totalRuns} run{totalRuns === 1 ? "" : "s"} in the last {days} days
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-muted-foreground">Last success:</span>
          {lastSuccess ? (
            <span
              className="min-w-0 truncate font-medium"
              title={formatInTimezone(new Date(lastSuccess.startTime), timeZone)}
            >
              {lastSuccess.configName} ·{" "}
              {formatDistanceToNow(new Date(lastSuccess.startTime), { addSuffix: true })}
            </span>
          ) : (
            <span className="font-medium text-muted-foreground">Never</span>
          )}
          <Badge
            variant={
              overdue ? (overdue.length > 0 ? "warning" : "success") : "muted"
            }
          >
            {overdue
              ? overdue.length > 0
                ? `Overdue: ${overdue.length}`
                : "On schedule"
              : "Checking schedules…"}
          </Badge>
        </div>

        {overdue && overdue.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Needs attention
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {overdue.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/backups/${item.id}`}
                    className="text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
            {overdue.length > 3 ? (
              <Link
                href="/backups"
                className="mt-1 inline-block text-sm text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
              >
                +{overdue.length - 3} more overdue
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {view.rate == null ? (
              <>
                <div className="text-4xl font-bold tracking-tight text-muted-foreground">—</div>
                <div className="text-sm text-muted-foreground">
                  {selected ? "No finished runs this day" : "No finished runs yet"}
                </div>
              </>
            ) : (
              <>
                <div className={cn("text-4xl font-bold tracking-tight", rateTone)}>
                  {view.rate}%
                </div>
                <div className="text-sm text-muted-foreground">
                  Success rate of finished runs
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={historyHref(selectedDate, "running")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Running this day" : "View running backups"}
            >
              <PlayIcon aria-hidden="true" className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-blue-700 dark:text-blue-400">
                {view.running}
              </span>
            </Link>
            <Link
              href={historyHref(selectedDate, "success")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Successful this day" : "View successful backups"}
            >
              <CheckCircleIcon aria-hidden="true" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {view.success}
              </span>
            </Link>
            <Link
              href={historyHref(selectedDate, "failed")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Failed this day" : "View failed backups"}
            >
              <XCircleIcon aria-hidden="true" className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="font-medium text-destructive">{view.failed}</span>
            </Link>
          </div>
        </div>
        {view.rate != null ? (
          <Progress value={view.rate} className={cn("h-2", barTone)} />
        ) : null}
        <DayChart
          daily={daily}
          selectedDate={selectedDate}
          hoveredDate={hoveredDate}
          onSelect={toggleDay}
          onHover={setHoveredDate}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {hasChartData ? (
            <p className="text-muted-foreground">
              {hoveredDate
                ? "Tap or click the bar to filter this card"
                : selected
                  ? "Tap the selected bar again to show all days"
                  : "Tap or hover a day for counts · tap to filter"}
            </p>
          ) : (
            <span />
          )}
          <Link
            href={historyHref(selectedDate)}
            className="text-blue-700 hover:underline dark:text-blue-400"
          >
            {selected
              ? `View ${formatDay(selected.date, "MMM d")} in history`
              : "View all history"}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
