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
import { canRestoreBackup } from "@/lib/backup/restore-eligibility"
import { useRestoreBackupHistory } from "@/lib/hooks/useHistory"
import { PEER_RECALL_WAITING_MESSAGE } from "@/lib/peer/recall-pending"
import { RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

export type HistoryRestoreEntry = {
  id: string
  status?: string | null
  artifactPath?: string | null
  backupConfig?: {
    sourceType?: string | null
    sourcePath?: string | null
    destinationKind?: string | null
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
  const [open, setOpen] = useState(false)
  const [targetName, setTargetName] = useState(entry.backupConfig?.sourcePath || "")
  const [waitingForBro, setWaitingForBro] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

  const sourceType = entry.backupConfig?.sourceType || "path"
  const isDatabase = sourceType === "database"
  const isPath = sourceType === "path"

  const eligible = canRestoreBackup({
    status: entry.status,
    sourceType: entry.backupConfig?.sourceType,
    destinationKind: entry.backupConfig?.destinationKind,
    artifactPath: entry.artifactPath,
  })

  useEffect(() => {
    if (entry.backupConfig?.sourcePath) {
      setTargetName(entry.backupConfig.sourcePath)
    }
  }, [entry.backupConfig?.sourcePath])

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

  const handleRestore = () => {
    const configured = entry.backupConfig?.sourcePath || ""
    const requested = targetName.trim()
    const allowRetarget = Boolean(requested && configured && requested !== configured)
    const payload = isDatabase
      ? { id: entry.id, databaseName: requested || undefined, allowRetarget }
      : isPath
        ? { id: entry.id, targetPath: requested || undefined, allowRetarget }
        : { id: entry.id, volumeName: requested || undefined, allowRetarget }

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
              ? "This loads the .sql.gz dump into the target database using the backup’s connection settings. Existing objects may be overwritten or conflict depending on the dump contents."
              : isPath
                ? "This copies the backed-up files back onto the source (local path, SSH host, or S3 prefix). Existing files at the target may be overwritten. Artifacts on S3 or Bro are downloaded first; backups that landed only on a remote SSH destination cannot be restored from here."
                : "This uploads the backup archive to the remote host and extracts it into the target volume. Existing files in that volume will be overwritten. Images, networks, and compose config are not restored."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {waitingForBro ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {PEER_RECALL_WAITING_MESSAGE}
          </p>
        ) : null}
        <div className="space-y-2 py-2">
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
