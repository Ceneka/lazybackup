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
import { Progress } from "@/components/ui/progress"
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
import {
  deliveryErrorFor,
  deriveDeliveryState,
  peerIdForHistoryRow,
} from "@/lib/backup/delivery-state"
import { useRestoreBackupHistory } from "@/lib/hooks/useHistory"
import { usePeers } from "@/lib/hooks/usePeers"
import { useServers } from "@/lib/hooks/useServers"
import {
  friendAppKind,
  friendIsOnline,
  formatElapsed,
  RECALL_CLOSE_HINT_AFTER_MS,
  resolveFriendName,
  resolvePeer,
  restorePreflightCopy,
  restoreStages,
  restoreWaitingCopy,
  shouldStopRecallPolling,
} from "@/lib/peer/friend-copy"
import { PEER_RECALL_WAITING_MESSAGE } from "@/lib/peer/recall-pending"
import { formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import { AlertTriangleIcon, CheckCircle2Icon, RotateCcwIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

const LOCAL_HOST_VALUE = "local"

export type HistoryRestoreEntry = {
  id: string
  startTime?: string | null
  totalSize?: number | null
  status?: string | null
  artifactPath?: string | null
  artifactRemoved?: boolean | null
  mailboxPending?: boolean | null
  deliveryState?: string | null
  deliveryError?: string | null
  mailboxError?: string | null
  /** Contract C5 (optional until restore-core lands): defaults from the run. */
  restoreDefaults?: {
    targetPath: string | null
    targetServerId: string | null
    databaseName: string | null
    volumeName: string | null
    configChangedSinceRun: boolean
  } | null
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
    destinationPeerId?: string | null
    destinationPeer?: {
      id?: string | null
      name: string
      kind?: "lazybro" | "lazybackup" | null
      remoteBaseUrl?: string | null
      online?: boolean | null
      lastSeenAt?: string | null
    } | null
    dbEngine?: string | null
    server?: { id?: string | null; name: string } | null
    destinationServer?: { id?: string | null; name: string; authType?: string | null } | null
    sourceS3Profile?: { name: string } | null
    destinationS3Profile?: { name: string } | null
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
  const peersQuery = usePeers()
  const peers = peersQuery.data?.peers || []
  const [open, setOpen] = useState(false)
  const [targetName, setTargetName] = useState(entry.backupConfig?.sourcePath || "")
  const [waitingForBro, setWaitingForBro] = useState(false)
  const [recallStartedAt, setRecallStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [timedOut, setTimedOut] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoredTarget, setRestoredTarget] = useState<string | null>(null)
  const [retargetAcknowledged, setRetargetAcknowledged] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)
  const defaultsAppliedFor = useRef<string | null>(null)

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

  const peerId = peerIdForHistoryRow({
    artifactPath: entry.artifactPath,
    destinationPeerId: entry.backupConfig?.destinationPeerId,
    destinationPeer: entry.backupConfig?.destinationPeer,
  })
  const isPeerRun = Boolean(peerId)
  const peer = resolvePeer(peers, peerId)
  const friendName = resolveFriendName(peers, peerId)
  const friendKind = peer ? friendAppKind(peer) : null
  const friendOnline = friendIsOnline(peer)
  const deliveryState = deriveDeliveryState({
    status: entry.status,
    deliveryState: entry.deliveryState,
    mailboxPending: entry.mailboxPending,
    deliveryError: entry.deliveryError,
    mailboxError: entry.mailboxError,
    artifactPath: entry.artifactPath,
    artifactRemoved: entry.artifactRemoved,
    destinationKind: entry.backupConfig?.destinationKind,
  })
  const deliveryError = deliveryErrorFor({
    deliveryError: entry.deliveryError,
    mailboxError: entry.mailboxError,
  })
  const preflight = isPeerRun
    ? restorePreflightCopy({
        friendName,
        kind: friendKind,
        online: friendOnline,
        waitingForDelivery: deliveryState === "waiting",
      })
    : null
  const stages = restoreStages(friendName, friendKind)
  const waitingCopy = restoreWaitingCopy({
    friendName,
    kind: friendKind,
    online: friendOnline,
    elapsedMs,
  })

  const eligible = canRestoreBackup(restoreEligibilityFromHistory(entry))

  useEffect(() => {
    if (entry.restoreDefaults) return
    if (isGit) {
      setTargetName("")
      return
    }
    if (entry.backupConfig?.sourcePath) {
      setTargetName(entry.backupConfig.sourcePath)
    }
  }, [entry.backupConfig?.sourcePath, entry.restoreDefaults, isGit])

  useEffect(() => {
    if (entry.restoreDefaults) return
    setTargetHost(defaultHostValue)
  }, [defaultHostValue, entry.restoreDefaults])

  // Contract C5: prefill from the run itself, not today's live config.
  useEffect(() => {
    const defaults = entry.restoreDefaults
    if (!defaults || defaultsAppliedFor.current === entry.id) return
    defaultsAppliedFor.current = entry.id
    if (isDatabase) {
      if (defaults.databaseName) setTargetName(defaults.databaseName)
    } else if (isPath || isGit) {
      if (defaults.targetPath) setTargetName(defaults.targetPath)
    } else if (defaults.volumeName) {
      setTargetName(defaults.volumeName)
    }
    if (showHostPicker) {
      setTargetHost(defaults.targetServerId || LOCAL_HOST_VALUE)
    }
  }, [entry.id, entry.restoreDefaults, isDatabase, isGit, isPath, showHostPicker])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // Tick elapsed time; stop polling at the max instead of spinning forever.
  useEffect(() => {
    if (!waitingForBro || recallStartedAt == null) return
    const tick = () => {
      const elapsed = Date.now() - recallStartedAt
      setElapsedMs(elapsed)
      if (shouldStopRecallPolling(elapsed)) {
        stopPolling()
        setWaitingForBro(false)
        setTimedOut(true)
      }
    }
    tick()
    const handle = setInterval(tick, 1000)
    return () => clearInterval(handle)
  }, [waitingForBro, recallStartedAt, stopPolling])

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
  const actionLabel = preflight?.primaryLabel || "Restore"

  const finishRestore = (data: RestoreMutationData) => {
    stopPolling()
    setWaitingForBro(false)
    setTimedOut(false)
    setRestoreError(null)
    const target = data.targetPath || data.database || data.volumeName || targetName.trim()
    setRestoredTarget(target || "the target")
    const restored = data.database
      ? `database "${data.database}"`
      : data.targetPath
        ? `${isGit ? "Git mirror" : "path"} "${data.targetPath}"`
        : data.volumeName
          ? `volume "${data.volumeName}"`
          : "backup"
    onRestored?.({
      status: "success",
      message: `Restored ${restored} onto ${targetHostLabel}`,
      log: data.log,
    })
  }

  const failRestore = (message: string) => {
    stopPolling()
    setWaitingForBro(false)
    setRestoreError(message)
    onRestored?.({ status: "failed", message })
  }

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

  const resetForm = () => {
    stopPolling()
    setTargetName(isGit ? "" : entry.backupConfig?.sourcePath || "")
    setTargetHost(defaultHostValue)
    setRetargetAcknowledged(false)
    setRestoreError(null)
    setRestoredTarget(null)
    setWaitingForBro(false)
    setTimedOut(false)
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
    setRestoredTarget(null)
    setTimedOut(false)
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

    // After a failed attempt (e.g. the friend sent back a corrupt copy), the
    // server refuses until the client explicitly asks again.
    const retryFailedRecall = Boolean(restoreError)

    restoreMutation.mutate(
      { ...payload, retry: retryFailedRecall },
      {
        onSuccess: (data) => {
          if (data.status === "waiting") {
            setRecallStartedAt(Date.now())
            setElapsedMs(0)
            setWaitingForBro(true)
            if (!pollRef.current) {
              pollRef.current = setInterval(() => {
                if (inFlightRef.current) return
                inFlightRef.current = true
                restoreMutation.mutate(payload, {
                  onSuccess: (again) => {
                    if (again.status === "waiting") return
                    finishRestore(again)
                  },
                  onError: (error) => {
                    failRestore(
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
          finishRestore(data)
        },
        onError: (error) => {
          failRestore(
            error instanceof Error ? error.message : "Failed to restore backup"
          )
        },
      }
    )
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
          setTimedOut(false)
          setRestoreError(null)
          setRestoredTarget(null)
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
            {isPeerRun
              ? `This backup is stored on ${friendName}'s computer. We'll ask their app for it, then restore it here. Existing files at the target may be overwritten.`
              : isDatabase
                ? "This loads the .sql.gz dump into the target database using the backup’s connection settings. Existing objects may be overwritten or conflict depending on the dump contents. Credentials on a new host may not match — restore will fail clearly rather than using the original box."
                : isPath
                  ? "This copies the backed-up files back onto the target path (this host, an SSH host, or an S3 prefix). Existing files at the target may be overwritten. Artifacts on S3, Bro, or an SSH destination are pulled onto this host first."
                  : isGit
                    ? "This unpacks the bare Git mirror archive into the target directory (this host or an SSH dest). Existing files at that path may be overwritten."
                    : "This uploads the backup archive to the target host and extracts it into the target volume. Existing files in that volume will be overwritten. Images, networks, and compose config are not restored."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preflight ? (
          <RestorePreflightAlert
            preflight={preflight}
            restoredTarget={restoredTarget}
          />
        ) : null}

        {deliveryState === "failed" && deliveryError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Delivery failed</AlertTitle>
            <AlertDescription>{deliveryError}</AlertDescription>
          </Alert>
        ) : null}

        {entry.restoreDefaults?.configChangedSinceRun ? (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>This backup was changed after this run</AlertTitle>
            <AlertDescription>
              Targets below come from the run itself. Double-check the path or
              database before restoring.
            </AlertDescription>
          </Alert>
        ) : null}

        {restoredTarget ? (
          <Alert className="border-emerald-500/40 bg-emerald-500/10">
            <CheckCircle2Icon className="h-4 w-4" />
            <AlertTitle>Restore complete</AlertTitle>
            <AlertDescription>
              Restored to <span className="font-mono break-all">{restoredTarget}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        {restoreError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Restore failed</AlertTitle>
            <AlertDescription>{restoreError}</AlertDescription>
          </Alert>
        ) : null}

        {waitingForBro ? (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <Progress value={35} className="animate-pulse" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{waitingCopy.headline}</p>
              <p className="text-xs text-muted-foreground">{waitingCopy.detail}</p>
              <p className="text-xs text-muted-foreground">
                Elapsed {formatElapsed(elapsedMs)}
              </p>
              {waitingCopy.closeHint ? (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {waitingCopy.closeHint}
                </p>
              ) : null}
            </div>
            <ol className="space-y-1.5 text-sm">
              {stages.map((stage, index) => (
                <li key={stage.id} className="flex items-start gap-2">
                  <span
                    className={
                      index === 0
                        ? "mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500"
                        : "mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30"
                    }
                    aria-hidden
                  />
                  <span
                    className={
                      index === 0 ? "font-medium" : "text-muted-foreground"
                    }
                  >
                    {stage.label}
                  </span>
                </li>
              ))}
            </ol>
            {elapsedMs >= RECALL_CLOSE_HINT_AFTER_MS ? null : (
              <p className="text-xs text-muted-foreground">
                Keep this window open for progress — the request is saved even if
                you close it.
              </p>
            )}
          </div>
        ) : null}

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
            <p className="text-sm text-amber-700 dark:text-amber-400" aria-live="polite">
              {PEER_RECALL_WAITING_MESSAGE}
            </p>
          ) : null}

          <div className="space-y-3">
            {showHostPicker ? (
              <div className="space-y-2">
                <Label htmlFor={`restore-host-${entry.id}`}>Restore onto</Label>
                <Select
                  value={targetHost}
                  onValueChange={setTargetHost}
                  disabled={waitingForBro || Boolean(restoredTarget)}
                >
                  <SelectTrigger id={`restore-host-${entry.id}`} className="w-full">
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
                disabled={waitingForBro || Boolean(restoredTarget)}
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
            <AlertDialogCancel type="button">
              {waitingForBro || timedOut ? "Close" : restoredTarget ? "Done" : "Cancel"}
            </AlertDialogCancel>
            {restoredTarget ? null : timedOut ? (
              <LoadingButton
                type="button"
                onClick={handleRestore}
                isLoading={restoreMutation.isPending}
                loadingText="Requesting…"
              >
                Request again
              </LoadingButton>
            ) : (
              <LoadingButton
                type="submit"
                isLoading={restoreMutation.isPending || waitingForBro}
                loadingText={waitingForBro ? "Waiting for your friend…" : "Restoring…"}
                disabled={
                  !requestedTarget ||
                  restoreMutation.isPending ||
                  waitingForBro ||
                  needsRetargetAck
                }
              >
                {actionLabel}
              </LoadingButton>
            )}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Pre-restore warning (friend offline / delivery waiting). Hidden once a
 * restore has completed so the success state cannot sit next to a stale
 * "LazyBro is offline" warning.
 */
export function RestorePreflightAlert({
  preflight,
  restoredTarget,
}: {
  preflight: ReturnType<typeof restorePreflightCopy>
  restoredTarget: string | null
}) {
  if (!preflight || restoredTarget) return null
  return (
    <Alert
      className={
        preflight.tone === "warning"
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-blue-500/30 bg-blue-500/5"
      }
    >
      <AlertTriangleIcon className="h-4 w-4" />
      <AlertTitle>{preflight.title}</AlertTitle>
      <AlertDescription>{preflight.detail}</AlertDescription>
    </Alert>
  )
}
