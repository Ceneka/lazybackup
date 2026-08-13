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
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  canRestoreBackup,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { useRestoreBackupHistory } from "@/lib/hooks/useHistory"
import { useServers } from "@/lib/hooks/useServers"
import { PEER_RECALL_WAITING_MESSAGE } from "@/lib/peer/recall-pending"
import { RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

const LOCAL_HOST_VALUE = "local"

export type HistoryRestoreEntry = {
  id: string
  status?: string | null
  artifactPath?: string | null
  artifactRemoved?: boolean | null
  backupConfig?: {
    sourceType?: string | null
    sourceKind?: string | null
    sourcePath?: string | null
    destinationKind?: string | null
    server?: { id?: string | null; name?: string | null } | null
    destinationServer?: { authType?: string | null } | null
  } | null
}

type HistoryRestoreButtonProps = {
  entry: HistoryRestoreEntry
  /** Compact list trigger vs larger detail trigger */
  size?: "sm" | "default"
  variant?: "ghost" | "outline" | "secondary"
  className?: string
  /** Custom trigger (e.g. DetailActionButton). Defaults to a compact Button. */
  children?: ReactNode
  onRestored?: (log: string) => void
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

  const sourceType = entry.backupConfig?.sourceType || "path"
  const sourceKind = entry.backupConfig?.sourceKind || "server"
  const isDatabase = sourceType === "database"
  const isPath = sourceType === "path"
  const originalServerId = entry.backupConfig?.server?.id || ""
  const showHostPicker = sourceKind !== "s3"
  const defaultHostValue =
    sourceKind === "local" ? LOCAL_HOST_VALUE : originalServerId || LOCAL_HOST_VALUE
  const [targetHost, setTargetHost] = useState(defaultHostValue)

  const eligible = canRestoreBackup(restoreEligibilityFromHistory(entry))

  useEffect(() => {
    if (entry.backupConfig?.sourcePath) {
      setTargetName(entry.backupConfig.sourcePath)
    }
  }, [entry.backupConfig?.sourcePath])

  useEffect(() => {
    setTargetHost(defaultHostValue)
  }, [defaultHostValue])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  if (!eligible) {
    return null
  }

  const label = isDatabase ? "Restore DB" : isPath ? "Restore path" : "Restore volume"
  const servers = serversQuery.data || []
  const selectedServerId = targetHost === LOCAL_HOST_VALUE ? null : targetHost || null
  const originalHostId = sourceKind === "local" ? null : originalServerId || null
  const hostChanged = selectedServerId !== originalHostId

  const handleRestore = () => {
    const configured = entry.backupConfig?.sourcePath || ""
    const requested = targetName.trim()
    const nameChanged = Boolean(requested && configured && requested !== configured)
    const allowRetarget = Boolean(nameChanged || hostChanged)
    const payload = {
      id: entry.id,
      allowRetarget,
      targetServerId: selectedServerId || undefined,
      ...(isDatabase
        ? { databaseName: requested || undefined }
        : isPath
          ? { targetPath: requested || undefined }
          : { volumeName: requested || undefined }),
    }

    const onDoneWaiting = (log: string) => {
      stopPolling()
      setWaitingForBro(false)
      setOpen(false)
      onRestored?.(log)
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
                  onDoneWaiting(again.log)
                },
                onError: () => {
                  stopPolling()
                  setWaitingForBro(false)
                },
                onSettled: () => {
                  inFlightRef.current = false
                },
              })
            }, 3000)
          }
          return
        }
        onDoneWaiting(data.log)
      },
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          stopPolling()
          setWaitingForBro(false)
        }
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
                : "Restore Docker volume?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDatabase
              ? "This loads the .sql.gz dump into the target database using the backup’s connection settings. Existing objects may be overwritten or conflict depending on the dump contents. Credentials on a new host may not match — restore will fail clearly rather than using the original box."
              : isPath
                ? "This copies the backed-up files back onto the source (local path, SSH host, or S3 prefix). Existing files at the target may be overwritten. Artifacts on S3, Bro, or an SSH destination are pulled onto this host first."
                : "This uploads the backup archive to the target host and extracts it into the target volume. Existing files in that volume will be overwritten. Images, networks, and compose config are not restored."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {waitingForBro ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {PEER_RECALL_WAITING_MESSAGE}
          </p>
        ) : null}
        <div className="space-y-2 py-2">
          {showHostPicker ? (
            <div className="space-y-2">
              <label htmlFor={`restore-host-${entry.id}`} className="text-sm font-medium">
                Restore onto
              </label>
              <select
                id={`restore-host-${entry.id}`}
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {sourceKind === "local" ? (
                  <option value={LOCAL_HOST_VALUE}>This host</option>
                ) : originalServerId ? (
                  <option value={originalServerId}>
                    {entry.backupConfig?.server?.name || "Original server"}
                  </option>
                ) : (
                  <option value={LOCAL_HOST_VALUE}>This host</option>
                )}
                {servers
                  .filter((server) => server.id !== originalServerId)
                  .map((server) => (
                    <option
                      key={server.id}
                      value={server.id}
                      disabled={server.authType !== "key"}
                    >
                      {server.name} ({server.host})
                      {server.authType !== "key" ? " — needs SSH key" : ""}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <label htmlFor={`restore-target-${entry.id}`} className="text-sm font-medium">
            {isDatabase ? "Target database name" : isPath ? "Target path" : "Target volume name"}
          </label>
          <input
            id={`restore-target-${entry.id}`}
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={
              entry.backupConfig?.sourcePath ||
              (isDatabase ? "database" : isPath ? "/path/to/restore" : "volume-name")
            }
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoreMutation.isPending}>Cancel</AlertDialogCancel>
          <LoadingButton
            onClick={handleRestore}
            isLoading={restoreMutation.isPending || waitingForBro}
            loadingText={waitingForBro ? PEER_RECALL_WAITING_MESSAGE : "Restoring..."}
            disabled={!targetName.trim() || restoreMutation.isPending || waitingForBro}
          >
            Restore
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
