"use client"

import { PageHeader, PageLayout } from "@/components/page-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { QueryState } from "@/components/ui/query-state"
import {
  useStatus,
  type StatusCheck,
  type StatusSeverity,
} from "@/lib/hooks/useStatus"
import { cn } from "@/lib/utils"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  KeyRoundIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  XCircleIcon,
} from "lucide-react"
import Link from "next/link"

function severityOrder(s: StatusSeverity): number {
  if (s === "critical") return 0
  if (s === "warn") return 1
  if (s === "info") return 2
  return 3
}

function SeverityIcon({ severity }: { severity: StatusSeverity }) {
  if (severity === "critical") {
    return <XCircleIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
  }
  if (severity === "warn") {
    return <AlertTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
  }
  if (severity === "info") {
    return <InfoIcon className="h-5 w-5 text-sky-600 dark:text-sky-400" />
  }
  return <CheckCircle2Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
}

function checkRowClass(severity: StatusSeverity): string {
  if (severity === "critical") return "border-red-500/30 bg-red-500/5"
  if (severity === "warn") return "border-amber-500/30 bg-amber-500/5"
  if (severity === "info") return "border-sky-500/20 bg-sky-500/5"
  return "border-border bg-background"
}

function SummaryBanner({
  overall,
  headline,
  counts,
}: {
  overall: "critical" | "warn" | "ok"
  headline: string
  counts: { critical: number; warn: number; ok: number; info: number }
}) {
  return (
    <Card
      className={cn(
        "border",
        overall === "critical" && "border-red-500/40 bg-red-500/5",
        overall === "warn" && "border-amber-500/40 bg-amber-500/5",
        overall === "ok" && "border-emerald-500/30 bg-emerald-500/5"
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xl">
          {overall === "critical" ? (
            <ShieldAlertIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
          ) : overall === "warn" ? (
            <ShieldIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          ) : (
            <ShieldCheckIcon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          )}
          {headline}
        </CardTitle>
        <CardDescription>
          Based on what this instance stores — auth, encryption keys, instance
          backups, servers, and notifications.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="text-red-700 dark:text-red-400">
            {counts.critical} critical
          </span>
          <span className="text-amber-700 dark:text-amber-400">
            {counts.warn} warning{counts.warn === 1 ? "" : "s"}
          </span>
          <span className="text-sky-700 dark:text-sky-400">
            {counts.info} tip{counts.info === 1 ? "" : "s"}
          </span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {counts.ok} ok
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function CheckList({ checks }: { checks: StatusCheck[] }) {
  const sorted = [...checks].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity)
  )
  return (
    <ul className="space-y-2">
      {sorted.map((check) => (
        <li
          key={check.id}
          className={cn(
            "rounded-md border p-3 flex gap-3 items-start",
            checkRowClass(check.severity)
          )}
        >
          <SeverityIcon severity={check.severity} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-medium leading-snug">{check.title}</div>
            <p className="text-sm text-muted-foreground">{check.detail}</p>
            {check.href && (
              <Link
                href={check.href}
                className="inline-block text-sm underline underline-offset-2 hover:text-foreground text-muted-foreground"
              >
                Fix / review
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function StatChip({
  label,
  value,
  href,
}: {
  label: string
  value: string
  href?: string
}) {
  const inner = (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
  if (href) {
    return (
      <Link href={href} className="hover:bg-muted/40 rounded-md transition-colors">
        {inner}
      </Link>
    )
  }
  return inner
}

export default function StatusPage() {
  const query = useStatus()

  return (
    <PageLayout>
      <PageHeader
        title="Status"
        description="How safe is this LazyBackup instance?"
      />

      <QueryState query={query} dataLabel="status">
        {query.data && (
          <div className="space-y-6">
            <SummaryBanner
              overall={query.data.summary.overall}
              headline={query.data.summary.headline}
              counts={{
                critical: query.data.summary.criticalCount,
                warn: query.data.summary.warnCount,
                ok: query.data.summary.okCount,
                info: query.data.summary.infoCount,
              }}
            />

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <StatChip
                label="Login"
                value={
                  !query.data.auth.authEnabled
                    ? "Unlocked"
                    : query.data.auth.hasPassword && query.data.auth.hasPasskeys
                      ? "Password + passkey"
                      : query.data.auth.hasPasskeys
                        ? "Passkey"
                        : "Password"
                }
                href="/settings"
              />
              <StatChip
                label="Age encryption"
                value={
                  query.data.encryption.configured
                    ? query.data.encryption.needsExportAck
                      ? "Key needs export"
                      : `${query.data.encryption.keyCount} key${query.data.encryption.keyCount === 1 ? "" : "s"}`
                    : "No key"
                }
                href="/settings?tab=encryption"
              />
              <StatChip
                label="Instance backup"
                value={
                  query.data.instanceBackup.configCount === 0
                    ? "Not configured"
                    : query.data.instanceBackup.lastSuccess
                      ? `OK · ${query.data.instanceBackup.lastSuccess.ageDays}d ago`
                      : "Never succeeded"
                }
                href="/backups/new?source=lazybackup_instance"
              />
              <StatChip
                label="Failure webhook"
                value={
                  query.data.notifications.failureWebhookConfigured
                    ? "Configured"
                    : "Off"
                }
                href="/settings"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRoundIcon className="h-4 w-4" />
                  Checklist
                </CardTitle>
                <CardDescription>
                  Critical and warnings first. Tips are optional hardening.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CheckList checks={query.data.checks} />
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              Updated {new Date(query.data.generatedAt).toLocaleString()} ·
              refreshes every minute
            </p>
          </div>
        )}
      </QueryState>
    </PageLayout>
  )
}
