"use client"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  sourceEndpointName,
  sourcePathLabel,
} from "@/lib/backup/endpoint-display"
import {
  canRestoreBackup,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { useRestoreBackupHistory } from "@/lib/hooks/useHistory"
import { useServers } from "@/lib/hooks/useServers"
import { PEER_RECALL_WAITING_MESSAGE } from "@/lib/peer/recall-pending"
import { formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import { RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

const LOCAL_HOST_VALUE = "local"

export type HistoryRestoreEntry = {
  id: string
  startTime?: string | null
  totalSize?: number | null
  status?: string | null
  artifactPath?: string | null
  artifactRemoved?: boolean | null
  mailboxPending?: boolean | null
  backupConfig?: {
    name?: string | null
    sourceType?:
      | "path"
      | "docker_volume"
      | "database"
      | "lazybackup_instance"
      | "git_repo"
      | null
    sourceKind?: "local" | "server" | "s3" | "git" | null
    sourcePath?: string | null
    destinationKind?: "local" | "server" | "s3" | "peer" | null
    destinationPath?: string | null
    dbEngine?: string | null
    server?: { id?: string | null; name: string } | null
    destinationServer?: {
      id?: string | null
      name: string
      authType?: string | null
    } | null
    sourceS3Profile?: { name: string } | null
    destinationS3Profile?: { name: string } | null
    destinationPeer?: { name: string } | null
    sourceGitRepo?: { name: string } | null
  } | null
}

/** Outcome shown persistently on the detail page after a restore attempt. */
export type HistoryRestoreResult = {
  status: "success" | "failed"
  message: string
  log?: string
}

type RestoreMutationData = {
  database?: string
  targetPath?: string
  volumeName?: string
  log?: string
}

type HistoryRestoreButtonProps = {
  entry: HistoryRestoreEntry
  /** Compact list trigger vs larger detail trigger */
  size?: "sm" | "default"
  variant?: "ghost" | "outline" | "secondary"
  className?: string
  /** Custom trigger (e.g. DetailActionButton). Defaults to a compact Button. */
  children?: ReactNode
  onRestored?: (result: HistoryRestoreResult) => void
}

export function HistoryRestoreButton({
  entry,
  size = "sm",
  variant = "ghost",
  className,
  children,
  onRestored,
}: HistoryRestoreButtonProps) {
  const restoreMutation = useRestoreBackupHistory()
  const serversQuery = useServers()
  const [open, setOpen] = useState(false)
  const [targetName, setTargetName] = useState(entry.backupConfig?.sourcePath || "")
  const [waitingForBro, setWaitingForBro] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [retargetAcknowledged, setRetargetAcknowledged] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

  const sourceType = entry.backupConfig?.sourceType || "path"
  const sourceKind = entry.backupConfig?.sourceKind || "server"
  const isDatabase = sourceType === "database"
  const isPath = sourceType === "path"
  const isGit = sourceType === "git_repo"
  const originalServerId = entry.backupConfig?.server?.id || ""
  const showHostPicker = sourceKind !== "s3"
  const defaultHostValue =
    sourceKind === "local" || sourceKind === "git"
      ? LOCAL_HOST_VALUE
      : originalServerId || LOCAL_HOST_VALUE
  const [targetHost, setTargetHost] = useState(defaultHostValue)

  const eligible = canRestoreBackup(restoreEligibilityFromHistory(entry))

  useEffect(() => {
    if (isGit) {
      setTargetName("")
      return
    }
    if (entry.backupConfig?.sourcePath) {
      setTargetName(entry.backupConfig.sourcePath)
    }
  }, [entry.backupConfig?.sourcePath, isGit])

  useEffect(() => {
    setTargetHost(defaultHostValue)
  }, [defaultHostValue])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  if (!eligible) {
    return null
  }

  const label = isDatabase
    ? "Restore DB"
    : isPath
      ? "Restore path"
      : isGit
        ? "Restore Git"
        : "Restore volume"
  const servers = serversQuery.data || []
  const selectedServerId = targetHost === LOCAL_HOST_VALUE ? null : targetHost || null
  const selectedServer = selectedServerId
    ? servers.find((server) => server.id === selectedServerId) || null
    : null
  const targetHostLabel = selectedServer
    ? selectedServer.name
    : selectedServerId
      ? selectedServerId === originalServerId
        ? entry.backupConfig?.server?.name || "Selected server"
        : "Selected server"
      : "This host"
  const originalHostId =
    sourceKind === "local" || sourceKind === "git" ? null : originalServerId || null
  const hostChanged = selectedServerId !== originalHostId

  const configuredTarget = entry.backupConfig?.sourcePath || ""
  const requestedTarget = targetName.trim()
  const nameChanged = Boolean(
    requestedTarget && configuredTarget && requestedTarget !== configuredTarget
  )
  const retargeting = hostChanged || nameChanged
  const needsRetargetAck = retargeting && !retargetAcknowledged

  const summaryParts = [
    entry.backupConfig?.name || "Backup",
    entry.startTime ? format(new Date(entry.startTime), "PPp") : null,
    entry.totalSize != null ? formatBytes(entry.totalSize) : null,
  ].filter((part): part is string => Boolean(part))

  const sourceLabel = entry.backupConfig
    ? sourceEndpointName(entry.backupConfig)
    : "—"
  const sourcePathText = entry.backupConfig
    ? sourcePathLabel(entry.backupConfig)
    : ""
  const targetNameLabel = isDatabase
    ? `database ${requestedTarget || "…"}`
    : isPath || isGit
      ? requestedTarget || "…"
      : `volume ${requestedTarget || "…"}`

  const retargetReason =
    hostChanged && nameChanged
      ? "a different host and target"
      : hostChanged
        ? "a different host"
        : "a different target"

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const resetForm = () => {
    stopPolling()
    setTargetName(isGit ? "" : entry.backupConfig?.sourcePath || "")
    setTargetHost(defaultHostValue)
    setRetargetAcknowledged(false)
    setRestoreError(null)
    setWaitingForBro(false)
    inFlightRef.current = false
  }

  const handleRestore = () => {
    if (
      !requestedTarget ||
      restoreMutation.isPending ||
      waitingForBro ||
      needsRetargetAck
    ) {
      return
    }
    setRestoreError(null)
    const destinationLabel = targetHostLabel
    const payload = {
      id: entry.id,
      allowRetarget: retargeting,
      targetServerId: selectedServerId || undefined,
      ...(isDatabase
        ? { databaseName: requestedTarget || undefined }
        : isPath || isGit
          ? { targetPath: requestedTarget || undefined }
          : { volumeName: requestedTarget || undefined }),
    }

    const finish = (data: RestoreMutationData) => {
      stopPolling()
      setWaitingForBro(false)
      setOpen(false)
      const restoredTarget = data.database
        ? `database "${data.database}"`
        : data.targetPath
          ? `${isGit ? "Git mirror" : "path"} "${data.targetPath}"`
          : data.volumeName
            ? `volume "${data.volumeName}"`
            : "backup"
      onRestored?.({
        status: "success",
        message: `Restored ${restoredTarget} onto ${destinationLabel}`,
        log: data.log,
      })
    }

    const fail = (message: string) => {
      stopPolling()
      setWaitingForBro(false)
      setRestoreError(message)
      onRestored?.({ status: "failed", message })
    }

    restoreMutation.mutate(payload, {
      onSuccess: (data) => {
        if (data.status === "waiting") {
          setWaitingForBro(true)
          if (!pollRef.current) {
            pollRef.current = setInterval(() => {
              if (inFlightRef.current) return
              inFlightRef.current = true
              restoreMutation.mutate(payload, {
                onSuccess: (again) => {
                  if (again.status === "waiting") return
                  finish(again)
                },
                onError: (error) => {
                  fail(
                    error instanceof Error ? error.message : "Failed to restore backup"
                  )
                },
                onSettled: () => {
                  inFlightRef.current = false
                },
              })
            }, 3000)
          }
          return
        }
        finish(data)
      },
      onError: (error) => {
        fail(error instanceof Error ? error.message : "Failed to restore backup")
      },
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          resetForm()
        } else {
          stopPolling()
          setWaitingForBro(false)
        }
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        {children || (
          <Button type="button" variant={variant} size={size} className={className}>
            <RotateCcwIcon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {label}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDatabase
              ? "Restore database dump?"
              : isPath
                ? "Restore path tree?"
                : isGit
                  ? "Restore Git mirror?"
                  : "Restore Docker volume?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDatabase
              ? "This loads the .sql.gz dump into the target database using the backup’s connection settings. Credentials on a new host may not match — restore will fail clearly rather than using the original box."
              : isPath
                ? "This copies the backed-up files back onto the target path (this host, an SSH host, or an S3 prefix). Artifacts on S3, Bro, or an SSH destination are pulled onto this host first."
                : isGit
                  ? "This unpacks the bare Git mirror archive into the target directory (this host or an SSH dest)."
                  : "This uploads the backup archive to the target host and extracts it into the target volume. Images, networks, and compose config are not restored."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            handleRestore()
          }}
        >
          <div
            className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"
            role="group"
            aria-label="Restore summary"
          >
            <p className="font-medium">{summaryParts.join(" · ")}</p>
            <p className="break-words text-muted-foreground">
              <span className="font-medium text-foreground">From</span>{" "}
              {sourceLabel}
              {sourcePathText ? ` · ${sourcePathText}` : ""}
            </p>
            <p className="break-words text-muted-foreground">
              <span className="font-medium text-foreground">To</span>{" "}
              {targetHostLabel} · {targetNameLabel}
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              {isDatabase
                ? "Existing objects may be overwritten or conflict depending on the dump contents."
                : "This is a merge: files at the target that are not in the backup are not deleted."}
            </p>
          </div>

          {waitingForBro ? (
            <p
              className="text-sm text-amber-700 dark:text-amber-400"
              aria-live="polite"
            >
              {PEER_RECALL_WAITING_MESSAGE}
            </p>
          ) : null}

          {restoreError ? (
            <Alert
              variant="destructive"
              className="border-destructive/40 bg-destructive/5"
            >
              <AlertTitle>Restore failed</AlertTitle>
              <AlertDescription className="break-words text-foreground">
                {restoreError}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            {showHostPicker ? (
              <div className="space-y-2">
                <Label htmlFor={`restore-host-${entry.id}`}>Restore onto</Label>
                <Select value={targetHost} onValueChange={setTargetHost}>
                  <SelectTrigger
                    id={`restore-host-${entry.id}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[130]">
                    {sourceKind === "local" || sourceKind === "git" ? (
                      <SelectItem value={LOCAL_HOST_VALUE}>This host</SelectItem>
                    ) : originalServerId ? (
                      <SelectItem value={originalServerId}>
                        {entry.backupConfig?.server?.name || "Original server"}
                      </SelectItem>
                    ) : (
                      <SelectItem value={LOCAL_HOST_VALUE}>This host</SelectItem>
                    )}
                    {servers
                      .filter((server) => server.id !== originalServerId)
                      .map((server) => (
                        <SelectItem
                          key={server.id}
                          value={server.id}
                          disabled={server.authType !== "key"}
                        >
                          {server.name} ({server.host})
                          {server.authType !== "key" ? " — needs SSH key" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={`restore-target-${entry.id}`}>
                {isDatabase
                  ? "Target database name"
                  : isPath
                    ? "Target path"
                    : isGit
                      ? "Target directory"
                      : "Target volume name"}
              </Label>
              <Input
                id={`restore-target-${entry.id}`}
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                required
                aria-describedby={`restore-target-help-${entry.id}`}
                placeholder={
                  isGit
                    ? "/backups/git/restore"
                    : entry.backupConfig?.sourcePath ||
                      (isDatabase ? "database" : isPath ? "/path/to/restore" : "volume-name")
                }
              />
              <p
                id={`restore-target-help-${entry.id}`}
                className="text-xs text-muted-foreground"
              >
                {isDatabase
                  ? "The dump is loaded into this database name on the selected host."
                  : isGit
                    ? "The bare mirror archive is unpacked into this directory."
                    : "Existing files are overwritten; files absent from the backup are not deleted."}
              </p>
            </div>
          </div>

          {retargeting ? (
            <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <input
                type="checkbox"
                checked={retargetAcknowledged}
                onChange={(e) => setRetargetAcknowledged(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
              />
              <span>
                I understand this restores to {retargetReason} than the backup’s
                source location.
              </span>
            </label>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              disabled={restoreMutation.isPending && !waitingForBro}
            >
              Cancel
            </AlertDialogCancel>
            <LoadingButton
              type="submit"
              isLoading={restoreMutation.isPending || waitingForBro}
              loadingText={waitingForBro ? "Waiting for Bro…" : "Restoring..."}
              disabled={
                !requestedTarget ||
                restoreMutation.isPending ||
                waitingForBro ||
                needsRetargetAck
              }
            >
              Restore
            </LoadingButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
