"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
  detailActionPrimaryClassName,
  detailActionSecondaryClassName,
} from "@/components/ui/detail-actions"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { formatCronExpression } from "@/lib/cron/format"
import {
  backupKeys,
  useBackup,
  useBackupStorage,
  useDeleteBackup,
  validateBackup,
  type BackupDestinationEntry,
  type ValidateBackupResult,
} from "@/lib/hooks/useBackups"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  HardDriveIcon,
  HistoryIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  XCircleIcon,
  AlertTriangleIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

function formatMtime(value: string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function EntryRows({
  entries,
  emptyLabel,
}: {
  entries: BackupDestinationEntry[]
  emptyLabel: string
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
              {formatMtime(entry.mtime)}
            </p>
          </div>
          <div className="shrink-0 text-right font-medium tabular-nums">{entry.size}</div>
        </li>
      ))}
    </ul>
  )
}

export default function BackupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const backupId = params.id as string
  const queryClient = useQueryClient()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  const query = useBackup(backupId)
  const storageQuery = useBackupStorage(backupId)
  const deleteBackup = useDeleteBackup()
  const [validateResult, setValidateResult] = useState<ValidateBackupResult | null>(null)

  const runBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}/run`, {
        method: "POST",
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || "Failed to start backup")
      }

      return backupId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] })
      queryClient.invalidateQueries({ queryKey: backupKeys.storage(backupId) })
      toast.success("Backup started successfully")
    },
    onError: (error) => {
      console.error("Error starting backup:", error)
      toast.error(error instanceof Error ? error.message : "Failed to start backup")
    },
  })

  const validateMutation = useMutation({
    mutationFn: () => validateBackup(backupId),
    onSuccess: (result) => {
      setValidateResult(result)
      if (result.ok) {
        const warns = result.checks.filter((c) => c.status === "warn")
        if (warns.length > 0) {
          toast.success(`Validation passed with ${warns.length} warning(s)`)
        } else {
          toast.success("Validation passed — ready to run")
        }
      } else {
        const firstFail = result.checks.find((c) => c.status === "fail")
        toast.error(firstFail?.message || "Validation failed")
      }
    },
    onError: (error) => {
      setValidateResult(null)
      toast.error(error instanceof Error ? error.message : "Failed to validate backup")
    },
  })

  const handleDelete = () => {
    deleteBackup.mutate(backupId, {
      onSuccess: () => {
        router.push("/backups")
      },
    })
  }

  const handleRunBackup = async () => {
    runBackupMutation.mutate()
  }

  const handleValidate = () => {
    validateMutation.mutate()
  }

  const scheduleLabel = query.data
    ? query.data.scheduleLabel || formatCronExpression(query.data.schedule)
    : ""

  const storage = storageQuery.data
  const listingEntries =
    storage?.versioning.enabled && storage.versioning.versionCount > 0
      ? storage.versioning.versions
      : storage?.topLevel ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link
            href="/backups"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to backups</span>
          </Link>
          <h1 className="text-3xl font-bold">
            <QueryState
              query={query}
              dataLabel="backup configuration"
              errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
              emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
              emptyMessage="Backup configuration not found"
              isDataEmpty={(data) => !data}
              loadingComponent={<span className="text-muted-foreground">Loading backup...</span>}
            >
              {query.data?.name}
            </QueryState>
          </h1>
        </div>
      </div>

      <QueryState
        query={query}
        dataLabel="backup configuration"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="Backup configuration not found"
        isDataEmpty={(data) => !data}
      >
        {query.data && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Backup Details</h2>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">From</dt>
                    <dd className="flex items-center space-x-2 text-lg">
                      {(query.data.sourceKind || "server") === "local" ? (
                        <HardDriveIcon className="h-4 w-4" />
                      ) : (
                        <ServerIcon className="h-4 w-4" />
                      )}
                      <span>
                        {(query.data.sourceKind || "server") === "local"
                          ? "This host"
                          : query.data.server?.name || "Unknown server"}
                        {query.data.sourceType === "docker_volume"
                          ? ` · volume ${query.data.sourcePath}`
                          : query.data.sourceType === "database"
                            ? ` · ${query.data.dbEngine || "db"} ${query.data.sourcePath}`
                            : ` · ${query.data.sourcePath}`}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">To</dt>
                    <dd className="flex items-center space-x-2 text-lg">
                      {(query.data.destinationKind || "local") === "local" ? (
                        <HardDriveIcon className="h-4 w-4" />
                      ) : (
                        <ServerIcon className="h-4 w-4" />
                      )}
                      <span>
                        {(query.data.destinationKind || "local") === "local"
                          ? "This host"
                          : query.data.destinationServer?.name || "Unknown server"}
                        {` · ${query.data.destinationPath}`}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Source Type</dt>
                    <dd className="text-lg">
                      {query.data.sourceType === "docker_volume"
                        ? "Docker volume"
                        : query.data.sourceType === "database"
                          ? `Database dump (${query.data.dbEngine || "unknown"})`
                          : "Filesystem path"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Schedule</dt>
                    <dd className="flex items-center space-x-2 text-lg">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {scheduleLabel} ({query.data.schedule})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Next run</dt>
                    <dd className="flex items-center space-x-2 text-lg">
                      <ClockIcon className="h-4 w-4" />
                      {query.data.enabled ? (
                        <span>
                          {query.data.nextRunFormatted || "—"}
                          {query.data.timezone ? (
                            <span className="ml-2 text-sm text-muted-foreground">
                              ({query.data.timezone})
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Disabled</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                    <dd className="text-lg">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          query.data.enabled
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {query.data.enabled ? "Active" : "Disabled"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Versioning</dt>
                    <dd className="text-lg">
                      {query.data.enableVersioning
                        ? `Enabled (keep ${query.data.versionsToKeep ?? 5})`
                        : "Disabled"}
                    </dd>
                  </div>
                  {query.data.excludePatterns && (
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Exclude Patterns</dt>
                      <dd className="mt-1 whitespace-pre-wrap rounded bg-gray-100 p-2 font-mono text-sm">
                        {query.data.excludePatterns}
                      </dd>
                    </div>
                  )}
                  {query.data.preBackupCommands && (
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">
                        Pre-Backup Commands
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap rounded bg-gray-100 p-2 font-mono text-sm">
                        {query.data.preBackupCommands}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Actions</h2>
                <DetailActions>
                  <LoadingButton
                    onClick={handleRunBackup}
                    isLoading={runBackupMutation.isPending}
                    loadingText="Starting…"
                    className={detailActionPrimaryClassName}
                  >
                    <PlayIcon className="h-4 w-4" />
                    Run now
                  </LoadingButton>

                  <LoadingButton
                    onClick={handleValidate}
                    isLoading={validateMutation.isPending}
                    loadingText="Validating…"
                    variant="secondary"
                    className={detailActionSecondaryClassName}
                  >
                    <ShieldCheckIcon className="h-4 w-4" />
                    Validate
                  </LoadingButton>

                  <DetailActionLink href={`/backups/${query.data.id}/edit`}>
                    <PencilIcon className="h-4 w-4" />
                    Edit
                  </DetailActionLink>

                  <DetailActionLink href={`/backups/new?cloneFrom=${query.data.id}`}>
                    <CopyIcon className="h-4 w-4" />
                    Clone
                  </DetailActionLink>

                  <DetailActionLink href={`/history?configId=${query.data.id}`}>
                    <HistoryIcon className="h-4 w-4" />
                    View history
                  </DetailActionLink>

                  {query.data.serverId && (
                    <DetailActionLink href={`/servers/${query.data.serverId}`}>
                      <ServerIcon className="h-4 w-4" />
                      View source server
                    </DetailActionLink>
                  )}
                  {query.data.destinationServerId && (
                    <DetailActionLink href={`/servers/${query.data.destinationServerId}`}>
                      <ServerIcon className="h-4 w-4" />
                      View destination server
                    </DetailActionLink>
                  )}

                  <DetailActionsDivider />

                  <DeleteConfirmationDialog
                    title="Delete this backup?"
                    description="This deletes the backup configuration and its history rows. Files already on disk at the destination are not removed."
                    onDelete={handleDelete}
                    isDeleting={deleteBackup.isPending}
                    buttonText="Delete"
                  />
                </DetailActions>

                {validateResult && (
                  <div className="mt-4 space-y-2 border-t pt-4">
                    <p className="text-sm font-medium">
                      Validation{" "}
                      {validateResult.ok ? (
                        <span className="text-green-600 dark:text-green-400">passed</span>
                      ) : (
                        <span className="text-destructive">failed</span>
                      )}
                    </p>
                    <ul className="space-y-2 text-sm">
                      {validateResult.checks.map((check) => (
                        <li
                          key={check.id}
                          className="flex gap-2 rounded-md border bg-muted/30 px-3 py-2"
                        >
                          {check.status === "pass" ? (
                            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          ) : check.status === "warn" ? (
                            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          ) : (
                            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">{check.label}</div>
                            <p className="text-xs text-muted-foreground">{check.message}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-semibold">
                    <HardDriveIcon className="h-5 w-5" />
                    On-disk backups
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(query.data.destinationKind || "local") === "server"
                      ? "Destination is on a remote server — local disk listing is unavailable."
                      : "Resume of files stored at this destination on the LazyBackup host."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => storageQuery.refetch()}
                  disabled={storageQuery.isFetching}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCwIcon
                    className={`h-4 w-4 ${storageQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
              </div>

              <QueryState
                query={storageQuery}
                dataLabel="on-disk backups"
                errorIcon={<HardDriveIcon className="h-12 w-12 text-red-500" />}
                emptyIcon={<HardDriveIcon className="h-12 w-12 text-muted-foreground" />}
                emptyMessage="No storage summary available"
                isDataEmpty={(data) => !data}
              >
                {storage && storage.remote ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      Remote destination
                      {storage.remoteServerName ? ` on ${storage.remoteServerName}` : ""}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground" title={storage.path}>
                      {storage.path}
                    </p>
                  </div>
                ) : storage && (
                  <div className="space-y-5">
                    {!storage.exists ? (
                      <p className="text-sm text-muted-foreground">
                        Destination path not found yet. It is created when the first backup runs.
                      </p>
                    ) : (
                      <>
                        <div>
                          <div className="text-3xl font-bold">{storage.totalSize}</div>
                          <div className="text-sm text-muted-foreground">Total on disk</div>
                          <p
                            className="mt-1 truncate font-mono text-xs text-muted-foreground"
                            title={storage.path}
                          >
                            {storage.path}
                          </p>
                        </div>

                        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                          <div className="rounded-md bg-muted/40 p-3">
                            <dt className="text-muted-foreground">Files</dt>
                            <dd className="text-lg font-semibold">{storage.fileCount}</dd>
                          </div>
                          <div className="rounded-md bg-muted/40 p-3">
                            <dt className="text-muted-foreground">Folders</dt>
                            <dd className="text-lg font-semibold">{storage.directoryCount}</dd>
                          </div>
                          <div className="rounded-md bg-muted/40 p-3">
                            <dt className="text-muted-foreground">Versioning</dt>
                            <dd className="text-lg font-semibold">
                              {storage.versioning.enabled
                                ? `${storage.versioning.versionCount}/${storage.versioning.versionsToKeep ?? "—"}`
                                : "Off"}
                            </dd>
                          </div>
                          <div className="rounded-md bg-muted/40 p-3">
                            <dt className="text-muted-foreground">Last modified</dt>
                            <dd className="text-sm font-semibold leading-6">
                              {isClient ? formatMtime(storage.lastModified) : "—"}
                            </dd>
                          </div>
                        </dl>

                        <div>
                          <h3 className="mb-2 text-sm font-medium">
                            {storage.versioning.enabled && storage.versioning.versionCount > 0
                              ? "Versions"
                              : "Top-level entries"}
                          </h3>
                          <EntryRows
                            entries={listingEntries}
                            emptyLabel="Destination exists but has no readable files yet."
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
                )}
              </QueryState>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
