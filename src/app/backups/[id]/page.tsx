"use client"

import {
  DetailField,
  DetailFields,
  ResourceDetailLayout,
  ResourcePageHeader,
} from "@/components/resource-detail-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
  detailActionDestructiveClassName,
  detailActionPrimaryClassName,
  detailActionSecondaryClassName,
} from "@/components/ui/detail-actions"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import {
  destinationEndpointName,
  destinationKindOf,
  sourceEndpointName,
  sourceKindOf,
  sourcePathLabel,
  sourceTypeLabel,
} from "@/lib/backup/endpoint-display"
import {
  formatRelativeTime,
  pickActiveRunningRun,
  type BackupRunStatus,
} from "@/lib/backup/run-status"
import { formatCronExpression, formatInTimezone } from "@/lib/cron/format"
import { formatDuration } from "@/lib/format/duration"
import { useHistoryList } from "@/lib/hooks/useHistory"
import {
  BackupNotFoundError,
  backupKeys,
  startBackup,
  useBackup,
  useBackupStorage,
  useDeleteBackup,
  useToggleBackup,
  validateBackup,
  type BackupDestinationEntry,
  type ValidateBackupResult,
} from "@/lib/hooks/useBackups"
import { flashClassName } from "@/lib/resource-actions"
import { cn } from "@/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  CloudIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  HardDriveIcon,
  HistoryIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

function EndpointGlyph({ kind }: { kind: string }) {
  const className = "h-4 w-4 shrink-0"
  if (kind === "local") return <HardDriveIcon className={className} />
  if (kind === "s3") return <CloudIcon className={className} />
  if (kind === "peer") return <UsersIcon className={className} />
  if (kind === "git") return <GitBranchIcon className={className} />
  return <ServerIcon className={className} />
}

function formatMtime(value: string | null | undefined, timeZone: string) {
  if (!value) return "—"
  return formatInTimezone(new Date(value), timeZone)
}

function validationSummary(checks: { status: string }[]) {
  const pass = checks.filter((c) => c.status === "pass").length
  const warn = checks.filter((c) => c.status === "warn").length
  const fail = checks.filter((c) => c.status === "fail").length
  const parts: string[] = []
  parts.push(`${pass} passed`)
  if (warn > 0) parts.push(`${warn} warning${warn === 1 ? "" : "s"}`)
  if (fail > 0) parts.push(`${fail} failed`)
  return parts.join(" · ")
}

const RUN_STATUS_LABEL = {
  success: "Success",
  failed: "Failed",
  running: "Running",
} as const

const RUN_STATUS_TONE = {
  success: "success",
  failed: "destructive",
  running: "info",
} as const

function RunStatusBadge({ status }: { status: BackupRunStatus }) {
  const Icon =
    status === "success"
      ? CheckCircle2Icon
      : status === "failed"
        ? XCircleIcon
        : Loader2Icon

  return (
    <Badge variant={RUN_STATUS_TONE[status]} className="gap-1">
      <Icon
        className={cn("h-3 w-3", status === "running" && "animate-spin")}
        aria-hidden
      />
      {RUN_STATUS_LABEL[status]}
    </Badge>
  )
}

function EntryRows({
  entries,
  emptyLabel,
  timeZone,
}: {
  entries: BackupDestinationEntry[]
  emptyLabel: string
  timeZone: string
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ul className="divide-y rounded-md border">
      {entries.map((entry) => (
        <li
          key={`${entry.type}-${entry.name}`}
          className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {entry.type === "directory" ? (
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate" title={entry.name}>
                {entry.name}
              </span>
              {entry.isVersionDir ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  version
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entry.type === "directory"
                ? `${entry.fileCount} file${entry.fileCount === 1 ? "" : "s"}`
                : "File"}
              {" · "}
              {formatMtime(entry.mtime, timeZone)}
            </p>
          </div>
          <div className="shrink-0 text-right font-medium tabular-nums">{entry.size}</div>
        </li>
      ))}
    </ul>
  )
}

/** Live "Running since HH:MM (elapsed)" banner with a link to the log. */
function RunningRunBanner({
  run,
  timeZone,
}: {
  run: { id: string; startTime: string }
  timeZone: string
}) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [run.id])

  const started = new Date(run.startTime)
  const elapsed = now ? formatDuration(now - started.getTime()) : null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200"
    >
      <Loader2Icon className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      <span className="min-w-0 flex-1">
        Running since {formatInTimezone(started, timeZone, { timeStyle: "short" })}
        {elapsed ? ` (${elapsed})` : null}
      </span>
      <Link
        href={`/history/${run.id}`}
        className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
      >
        View log
      </Link>
    </div>
  )
}

type RunningHistoryRow = {
  id: string
  status: string
  startTime: string
}

export default function BackupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const backupId = params.id as string
  const queryClient = useQueryClient()

  const query = useBackup(backupId)
  const storageQuery = useBackupStorage(backupId)
  const runningQuery = useHistoryList(
    { configId: backupId, status: "running" },
    { limit: 5, offset: 0 }
  )
  const deleteBackup = useDeleteBackup()
  const toggleBackup = useToggleBackup()

  const [validateResult, setValidateResult] = useState<ValidateBackupResult | null>(null)
  const [checksToggle, setChecksToggle] = useState<boolean | null>(null)
  const [runFlash, setRunFlash] = useState<"success" | "failed" | null>(null)

  const backup = query.data
  const timezone = backup?.timezone || "UTC"

  const runningRows = (runningQuery.data?.history ?? []) as RunningHistoryRow[]
  const runningRun = pickActiveRunningRun(runningRows)
  const isRunning = Boolean(runningRun)

  const displayedValidation: ValidateBackupResult | null =
    validateResult ??
    (backup?.lastValidation
      ? {
          ok: backup.lastValidation.ok,
          checks: backup.lastValidation.checks,
          at: backup.lastValidation.at,
        }
      : null)

  // Failed validations start expanded so the reason is visible on revisit.
  const checksExpanded =
    checksToggle ?? Boolean(displayedValidation && !displayedValidation.ok)

  useEffect(() => {
    if (!runFlash) return
    const timer = window.setTimeout(() => setRunFlash(null), 1400)
    return () => window.clearTimeout(timer)
  }, [runFlash])

  // When the running row disappears (finished), refresh last-run state even if
  // the SSE connection is unavailable.
  const sawRunningRun = useRef(false)
  useEffect(() => {
    if (runningRun) {
      sawRunningRun.current = true
      return
    }
    if (sawRunningRun.current && !runningQuery.isFetching) {
      sawRunningRun.current = false
      void queryClient.invalidateQueries({
        queryKey: backupKeys.detail(backupId),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
    }
  }, [runningRun, runningQuery.isFetching, queryClient, backupId])

  // Start the run and let the history row + SSE events drive progress.
  const startRunMutation = useMutation({
    mutationFn: () => startBackup(backupId),
    onSuccess: (outcome) => {
      setRunFlash("success")
      if (outcome.attached) {
        toast.info("A run is already in progress — following it")
      }
      void queryClient.invalidateQueries({ queryKey: ["history"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      void queryClient.invalidateQueries({
        queryKey: backupKeys.detail(backupId),
        exact: true,
      })
    },
    onError: (error) => {
      console.error("Error running backup:", error)
      setRunFlash("failed")
      toast.error(error instanceof Error ? error.message : "Failed to run backup")
    },
  })

  const validateMutation = useMutation({
    mutationFn: () => validateBackup(backupId),
    onSuccess: (result) => {
      setValidateResult(result)
      setChecksToggle(!result.ok)
      // exact: don't re-walk /storage just because validation ran.
      void queryClient.invalidateQueries({
        queryKey: backupKeys.detail(backupId),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      if (result.ok) {
        const warns = result.checks.filter((c) => c.status === "warn")
        if (warns.length > 0) {
          toast.success(
            `Validation passed with ${warns.length} warning${
              warns.length === 1 ? "" : "s"
            }`
          )
        } else {
          toast.success("Validation passed — ready to run")
        }
      } else {
        const firstFail = result.checks.find((c) => c.status === "fail")
        toast.error(firstFail?.message || "Validation failed")
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to validate backup")
    },
  })

  const scheduleLabel = backup
    ? backup.scheduleLabel || formatCronExpression(backup.schedule)
    : ""

  const storage = storageQuery.data
  const listingEntries =
    storage?.versioning.enabled && storage.versioning.versionCount > 0
      ? storage.versioning.versions
      : storage?.topLevel ?? []

  const notFound = query.error instanceof BackupNotFoundError

  return (
    <div className="space-y-6">
      <ResourcePageHeader
        backHref="/backups"
        backLabel="Back to backups"
        title={backup?.name ?? "Backup"}
      />

      {notFound ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <FolderIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Backup not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or this link is out of date.
          </p>
          <Button asChild className="mt-4">
            <Link href="/backups">
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back to backups
            </Link>
          </Button>
        </div>
      ) : (
        <QueryState
          query={query}
          dataLabel="backup configuration"
          errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
          emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
          emptyMessage="Backup configuration not found"
          isDataEmpty={(data) => !data}
        >
          {backup ? (
            <>
              {runningRun ? (
                <RunningRunBanner run={runningRun} timeZone={timezone} />
              ) : null}
              <ResourceDetailLayout
                backHref="/backups"
                backLabel="Back to backups"
                title={backup.name}
                hideHeader
                detailsTitle="Backup Details"
                details={
                  <DetailFields>
                    <DetailField label="From" className="text-base">
                      <div className="flex items-start gap-2">
                        <EndpointGlyph kind={sourceKindOf(backup)} />
                        <span className="min-w-0 break-all">
                          {sourceEndpointName(backup)}
                          <span className="text-muted-foreground"> · </span>
                          {sourcePathLabel(backup)}
                        </span>
                      </div>
                    </DetailField>
                    <DetailField label="To" className="text-base">
                      <div className="flex items-start gap-2">
                        <EndpointGlyph kind={destinationKindOf(backup)} />
                        <span className="min-w-0 break-all">
                          {destinationEndpointName(backup)}
                          <span className="text-muted-foreground"> · </span>
                          {backup.destinationPath}
                        </span>
                      </div>
                    </DetailField>
                    <DetailField label="Source Type">
                      {sourceTypeLabel(backup)}
                    </DetailField>
                    <DetailField label="Schedule">
                      <span className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 break-words">
                          {scheduleLabel} ({backup.schedule})
                        </span>
                      </span>
                    </DetailField>
                    <DetailField label="Next run">
                      {backup.enabled ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <ClockIcon className="h-4 w-4 shrink-0" />
                          <span>
                            {backup.nextRunFormatted || "—"}
                            {backup.timezone ? (
                              <span className="ml-2 text-sm text-muted-foreground">
                                ({backup.timezone})
                              </span>
                            ) : null}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Paused</span>
                      )}
                    </DetailField>
                    <DetailField label="Last run">
                      {backup.latestRun ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <RunStatusBadge status={backup.latestRun.status} />
                          <span
                            className="text-sm text-muted-foreground"
                            title={backup.latestRun.startTime}
                          >
                            {formatRelativeTime(backup.latestRun.startTime)}
                          </span>
                          <Link
                            href={`/history/${backup.latestRun.id}`}
                            className="text-sm underline underline-offset-2 hover:no-underline"
                          >
                            View log
                          </Link>
                          {backup.latestRun.status === "failed" &&
                          backup.latestRun.errorSnippet ? (
                            <p className="w-full break-words text-xs text-destructive">
                              {backup.latestRun.errorSnippet}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never run</span>
                      )}
                    </DetailField>
                    <DetailField label="Status">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={backup.enabled ? "success" : "muted"}>
                          {backup.enabled ? "Active" : "Paused"}
                        </Badge>
                        <LoadingButton
                          onClick={() => toggleBackup.mutate(backup.id)}
                          isLoading={toggleBackup.isPending}
                          loadingText={backup.enabled ? "Pausing…" : "Resuming…"}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                        >
                          {backup.enabled ? (
                            <PauseIcon className="mr-1 h-3.5 w-3.5" />
                          ) : (
                            <PlayIcon className="mr-1 h-3.5 w-3.5" />
                          )}
                          {backup.enabled ? "Pause" : "Resume"}
                        </LoadingButton>
                      </div>
                    </DetailField>
                    <DetailField label="Encryption">
                      {destinationKindOf(backup) === "peer"
                        ? "Encrypted (forced for Bro Space)"
                        : backup.enableEncryption
                          ? "Encrypted (age)"
                          : "Not encrypted"}
                    </DetailField>
                    <DetailField label="File retention">
                      {backup.enableFileRetention
                        ? `${backup.retentionMaxAge ?? 30} ${
                            backup.retentionMaxAgeUnit === "months"
                              ? "months"
                              : "days"
                          }, keep at least ${backup.retentionMinKeep ?? 5}`
                        : "Off"}
                    </DetailField>
                    <DetailField label="Versioning">
                      {backup.enableVersioning
                        ? `Enabled (keep ${backup.versionsToKeep ?? 5})`
                        : "Disabled"}
                    </DetailField>
                    {backup.deleteExtraneous ? (
                      <DetailField label="Mirror deletes">
                        On — destination files missing at source are removed (rsync --delete)
                      </DetailField>
                    ) : null}
                    {backup.excludePatterns && (
                      <div className="min-w-0">
                        <dt className="text-sm font-medium text-muted-foreground">
                          Exclude Patterns
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-sm">
                          {backup.excludePatterns}
                        </dd>
                      </div>
                    )}
                    {backup.preBackupCommands && (
                      <div className="min-w-0">
                        <dt className="text-sm font-medium text-muted-foreground">
                          Pre-Backup Commands
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-sm">
                          {backup.preBackupCommands}
                        </dd>
                      </div>
                    )}
                  </DetailFields>
                }
              actions={
                <DetailActions>
                  <LoadingButton
                    onClick={() => startRunMutation.mutate()}
                    isLoading={startRunMutation.isPending}
                    loadingText="Starting…"
                    disabled={isRunning}
                    className={cn(
                      detailActionPrimaryClassName,
                      flashClassName(runFlash)
                    )}
                  >
                    {isRunning ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <PlayIcon />
                    )}
                    {isRunning ? "Running…" : "Run now"}
                  </LoadingButton>

                  <LoadingButton
                    onClick={() => validateMutation.mutate()}
                    isLoading={validateMutation.isPending}
                    loadingText="Validating…"
                    variant="secondary"
                    className={detailActionSecondaryClassName}
                  >
                    <ShieldCheckIcon />
                    Validate
                  </LoadingButton>

                  <DetailActionLink href={`/backups/${backup.id}/edit`}>
                    <PencilIcon />
                    Edit
                  </DetailActionLink>

                  <DetailActionLink href={`/backups/new?cloneFrom=${backup.id}`}>
                    <CopyIcon />
                    Clone
                  </DetailActionLink>

                  <DetailActionLink href={`/history?configId=${backup.id}`}>
                    <HistoryIcon />
                    View history
                  </DetailActionLink>

                  {backup.serverId && (
                    <DetailActionLink href={`/servers/${backup.serverId}`}>
                      <ServerIcon />
                      Source server
                    </DetailActionLink>
                  )}
                  {backup.destinationServerId && (
                    <DetailActionLink href={`/servers/${backup.destinationServerId}`}>
                      <ServerIcon />
                      Destination server
                    </DetailActionLink>
                  )}
                  {backup.sourceS3ProfileId && (
                    <DetailActionLink href={`/s3-profiles/${backup.sourceS3ProfileId}`}>
                      <CloudIcon />
                      Source S3
                    </DetailActionLink>
                  )}
                  {backup.destinationS3ProfileId && (
                    <DetailActionLink
                      href={`/s3-profiles/${backup.destinationS3ProfileId}`}
                    >
                      <CloudIcon />
                      Destination S3
                    </DetailActionLink>
                  )}
                  {backup.sourceGitRepoId && (
                    <DetailActionLink href={`/git-repos/${backup.sourceGitRepoId}`}>
                      <GitBranchIcon />
                      Source Git
                    </DetailActionLink>
                  )}

                  <DetailActionsDivider />

                  <DeleteConfirmationDialog
                    title="Delete this backup?"
                    description="This deletes the backup configuration, its history, and its restore entries. Files stay at the destination, but they can no longer be restored through LazyBackup."
                    onConfirm={async () => {
                      await deleteBackup.mutateAsync(backup.id)
                      router.push("/backups")
                    }}
                    isPending={deleteBackup.isPending}
                    buttonText="Delete"
                    triggerButtonClassName={detailActionDestructiveClassName}
                  >
                    <button
                      type="button"
                      disabled={isRunning || startRunMutation.isPending}
                      title={
                        isRunning
                          ? "Cannot delete while a backup is running"
                          : undefined
                      }
                      className={cn(
                        detailActionDestructiveClassName,
                        "disabled:pointer-events-none disabled:opacity-50"
                      )}
                    >
                      <TrashIcon />
                      Delete
                    </button>
                  </DeleteConfirmationDialog>
                </DetailActions>
              }
              actionsExtra={
                displayedValidation ? (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          Validation{" "}
                          {displayedValidation.ok ? (
                            <span className="text-green-600 dark:text-green-400">
                              passed
                            </span>
                          ) : (
                            <span className="text-destructive">failed</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {displayedValidation.at
                            ? formatInTimezone(
                                new Date(displayedValidation.at),
                                timezone
                              )
                            : "Just now"}
                          {" · "}
                          {validationSummary(displayedValidation.checks)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setChecksToggle(!checksExpanded)}
                        aria-expanded={checksExpanded}
                        aria-controls="validation-checks"
                        className="shrink-0 cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {checksExpanded ? "Hide" : "Details"}
                      </button>
                    </div>
                    <ul
                      id="validation-checks"
                      hidden={!checksExpanded}
                      className="space-y-1.5 text-sm"
                    >
                      {displayedValidation.checks.map((check) => (
                        <li
                          key={check.id}
                          className="flex gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
                        >
                          {check.status === "pass" ? (
                            <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                          ) : check.status === "warn" ? (
                            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                          ) : (
                            <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium leading-tight">
                              {check.label}
                            </div>
                            <p className="break-words text-xs text-muted-foreground">
                              {check.message}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                    Not validated yet — run Validate to probe endpoints without
                    transferring data.
                  </p>
                )
              }
            >
              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-xl font-semibold">
                      <HardDriveIcon className="h-5 w-5" />
                      {destinationKindOf(backup) === "local"
                        ? "On-disk backups"
                        : "Destination storage"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {destinationKindOf(backup) === "server"
                        ? "Destination is on a remote server — local disk listing is unavailable."
                        : destinationKindOf(backup) === "s3"
                          ? "Destination is an S3 prefix — object listing is not shown here."
                          : destinationKindOf(backup) === "peer"
                            ? "Destination is a Bro peer — local disk listing is unavailable."
                            : "Summary of files stored at this destination on the LazyBackup host."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => storageQuery.refetch()}
                    disabled={storageQuery.isFetching}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCwIcon
                      className={`h-4 w-4 ${
                        storageQuery.isFetching ? "animate-spin" : ""
                      }`}
                    />
                    Refresh
                  </button>
                </div>

                <QueryState
                  query={storageQuery}
                  dataLabel="on-disk backups"
                  errorIcon={<HardDriveIcon className="h-12 w-12 text-red-500" />}
                  emptyIcon={
                    <HardDriveIcon className="h-12 w-12 text-muted-foreground" />
                  }
                  emptyMessage="No storage summary available"
                  isDataEmpty={(data) => !data}
                >
                  {storage && storage.remote ? (
                    <div className="space-y-2 text-sm">
                      <p>
                        Remote destination
                        {storage.remoteServerName
                          ? ` on ${storage.remoteServerName}`
                          : ""}
                      </p>
                      <p
                        className="break-all font-mono text-xs text-muted-foreground"
                        title={storage.path}
                      >
                        {storage.path}
                      </p>
                    </div>
                  ) : (
                    storage && (
                      <div className="space-y-5">
                        {!storage.exists ? (
                          <p className="text-sm text-muted-foreground">
                            Destination path not found yet. It is created when the
                            first backup runs.
                          </p>
                        ) : (
                          <>
                            <div>
                              <div className="text-3xl font-bold">
                                {storage.totalSize}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Total on disk
                              </div>
                              <p
                                className="mt-1 break-all font-mono text-xs text-muted-foreground"
                                title={storage.path}
                              >
                                {storage.path}
                              </p>
                            </div>

                            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                              <div className="rounded-md bg-muted/40 p-3">
                                <dt className="text-muted-foreground">Files</dt>
                                <dd className="text-lg font-semibold">
                                  {storage.fileCount}
                                </dd>
                              </div>
                              <div className="rounded-md bg-muted/40 p-3">
                                <dt className="text-muted-foreground">Folders</dt>
                                <dd className="text-lg font-semibold">
                                  {storage.directoryCount}
                                </dd>
                              </div>
                              <div className="rounded-md bg-muted/40 p-3">
                                <dt className="text-muted-foreground">
                                  Versioning
                                </dt>
                                <dd className="text-lg font-semibold">
                                  {storage.versioning.enabled
                                    ? `${storage.versioning.versionCount}/${
                                        storage.versioning.versionsToKeep ?? "—"
                                      }`
                                    : "Off"}
                                </dd>
                              </div>
                              <div className="rounded-md bg-muted/40 p-3">
                                <dt className="text-muted-foreground">
                                  Last modified
                                </dt>
                                <dd className="text-sm font-semibold leading-6">
                                  {formatMtime(storage.lastModified, timezone)}
                                </dd>
                              </div>
                            </dl>

                            <div>
                              <h3 className="mb-2 text-sm font-medium">
                                {storage.versioning.enabled &&
                                storage.versioning.versionCount > 0
                                  ? "Versions"
                                  : "Top-level entries"}
                              </h3>
                              <EntryRows
                                entries={listingEntries}
                                emptyLabel="Destination exists but has no readable files yet."
                                timeZone={timezone}
                              />
                              {storage.truncated ? (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Showing the newest entries only.
                                </p>
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  )}
                </QueryState>
              </div>
            </ResourceDetailLayout>
            </>
          ) : null}
        </QueryState>
      )}
    </div>
  )
}
