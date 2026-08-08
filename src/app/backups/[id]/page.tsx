"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { formatCronExpression } from "@/lib/cron/format"
import {
  backupKeys,
  useBackup,
  useBackupStorage,
  type BackupDestinationEntry,
} from "@/lib/hooks/useBackups"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  HardDriveIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete backup configuration")
      }

      return backupId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] })
      toast.success("Backup configuration deleted successfully")
      router.push("/backups")
    },
    onError: (error) => {
      console.error("Error deleting backup configuration:", error)
      toast.error("Failed to delete backup configuration")
    },
  })

  // Run backup mutation
  const runBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}/run`, {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to start backup")
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
      toast.error("Failed to start backup")
    },
  })

  const handleDelete = async () => {
    deleteMutation.mutate()
  }

  const handleRunBackup = async () => {
    runBackupMutation.mutate()
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
                    <dt className="text-sm font-medium text-muted-foreground">Server</dt>
                    <dd className="flex items-center space-x-2 text-lg">
                      <ServerIcon className="h-4 w-4" />
                      <span>{query.data.server?.name || "Unknown Server"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Source Path</dt>
                    <dd className="text-lg">{query.data.sourcePath}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Destination Path</dt>
                    <dd className="text-lg">{query.data.destinationPath}</dd>
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
                <div className="space-y-4">
                  <LoadingButton
                    onClick={handleRunBackup}
                    isLoading={runBackupMutation.isPending}
                    loadingText="Running..."
                    className="flex w-full items-center space-x-2 rounded-md bg-primary p-3 text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <PlayIcon className="mr-2 h-5 w-5" />
                    <span>Run Now</span>
                  </LoadingButton>

                  <Link
                    href={`/backups/${query.data.id}/edit`}
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <FolderIcon className="h-5 w-5" />
                    <span>Edit Backup Configuration</span>
                  </Link>
                  <Link
                    href={`/history?configId=${query.data.id}`}
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <CalendarIcon className="h-5 w-5" />
                    <span>View Backup History</span>
                  </Link>
                  <Link
                    href={`/servers/${query.data.serverId}`}
                    className="flex items-center space-x-2 rounded-md p-3 transition-colors hover:bg-accent"
                  >
                    <ServerIcon className="h-5 w-5" />
                    <span>View Server Details</span>
                  </Link>
                  <DeleteConfirmationDialog
                    title="Are you absolutely sure?"
                    description="This will permanently delete this backup configuration. This action cannot be undone."
                    onDelete={handleDelete}
                    isDeleting={deleteMutation.isPending}
                    buttonText="Delete"
                  />
                </div>
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
                    Resume of files stored at this destination on the LazyBackup host.
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
                {storage && (
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
