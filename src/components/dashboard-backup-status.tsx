"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { localDayRange } from "@/lib/backup/local-date"
import { successRate as calcSuccessRate } from "@/lib/backup/success-rate"
import type { DashboardDaily } from "@/lib/hooks/useDashboard"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
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
                {tip.total > 0 ? ` · ${calcSuccessRate(tip.success, tip.total)}%` : ""}
              </p>
            )}
          </div>
        ) : null}
        <div className="flex h-36 items-end gap-px" onMouseLeave={() => onHover(null)}>
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
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-end rounded-sm py-0.5 outline-none transition-colors",
                  "hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60",
                  isSelected && "bg-muted",
                  isHovered && !isSelected && "bg-muted/50"
                )}
              >
                <div
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
                    <div className="w-full bg-green-500" style={{ flex: day.success }} />
                  )}
                  {day.total === 0 && <div className="w-full flex-1 bg-muted-foreground/25" />}
                </div>
              </button>
            )
          })}
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
}: {
  days: number
  totalRuns: number
  successRate: number
  statusCounts: { running: number; success: number; failed: number }
  daily: DashboardDaily[]
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
        rate: selected.total === 0 ? null : calcSuccessRate(selected.success, selected.total),
      }
    : {
        running: statusCounts.running,
        success: statusCounts.success,
        failed: statusCounts.failed,
        total: totalRuns,
        rate: totalRuns === 0 ? null : successRate,
      }

  const toggleDay = (date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date))
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Backup status</CardTitle>
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
                className="text-blue-500 hover:underline"
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {view.rate == null ? (
              <>
                <div className="text-4xl font-bold tracking-tight text-muted-foreground">—</div>
                <div className="text-sm text-muted-foreground">
                  {selected ? "No runs this day" : "No runs yet"}
                </div>
              </>
            ) : (
              <>
                <div className="text-4xl font-bold tracking-tight">{view.rate}%</div>
                <div className="text-sm text-muted-foreground">Success rate</div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={historyHref(selectedDate, "running")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Running this day" : "View running backups"}
            >
              <PlayIcon className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-blue-500">{view.running}</span>
            </Link>
            <Link
              href={historyHref(selectedDate, "success")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Successful this day" : "View successful backups"}
            >
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
              <span className="font-medium text-green-500">{view.success}</span>
            </Link>
            <Link
              href={historyHref(selectedDate, "failed")}
              className="flex items-center gap-1.5 rounded-md transition-opacity hover:opacity-80"
              title={selected ? "Failed this day" : "View failed backups"}
            >
              <XCircleIcon className="h-4 w-4 text-red-500" />
              <span className="font-medium text-red-500">{view.failed}</span>
            </Link>
          </div>
        </div>
        {view.rate != null ? <Progress value={view.rate} className="h-2" /> : null}
        <DayChart
          daily={daily}
          selectedDate={selectedDate}
          hoveredDate={hoveredDate}
          onSelect={toggleDay}
          onHover={setHoveredDate}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">
            {hoveredDate
              ? "Click the bar to filter this card"
              : selected
                ? "Click the selected bar again to show all days"
                : "Hover a day for counts · click to filter"}
          </p>
          <Link
            href={historyHref(selectedDate)}
            className="text-blue-500 hover:underline"
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
