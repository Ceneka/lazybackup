"use client"

import { format } from "date-fns"
import {
  AlertTriangleIcon,
  ClockIcon,
  HardDriveIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Progress } from "@/components/ui/progress"
import { formatBytesShort, percentUsed } from "@/lib/bro/format"
import {
  derivePeerStatus,
  formatRelativeTime,
  humanizePeerError,
  peerKindLabel,
  type PeerStatusTone,
} from "@/lib/bro/peer-status"
import type { PeerSummary } from "@/lib/hooks/usePeers"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const TONE_BADGE: Record<PeerStatusTone, string> = {
  online:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  idle: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  never:
    "border-border bg-muted text-muted-foreground dark:bg-muted/50",
  attention:
    "border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40",
  revoked:
    "border-border bg-muted text-muted-foreground dark:bg-muted/50",
}

const TONE_DOT: Record<PeerStatusTone, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-500",
  never: "bg-muted-foreground/50",
  attention: "bg-destructive",
  revoked: "bg-muted-foreground/50",
}

function formatStoredAt(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return format(date, "MMM d, HH:mm")
}

export type PeerHealthCardProps = {
  peer: PeerSummary
  onRename: (peerId: string, name: string) => Promise<unknown>
  onRemove: (peerId: string) => Promise<unknown>
  /** Legacy fallback, only surfaced if Remove fails (C2 not available). */
  onRevoke?: (peerId: string) => Promise<unknown>
}

/**
 * One directional card per friend: presence, both quota bars, pending uploads,
 * the friend-app error (humanized), and safe actions.
 *
 * C1 fields are optional; missing values degrade to "Waiting for … to report".
 */
export function PeerHealthCard({
  peer,
  onRename,
  onRemove,
  onRevoke,
}: PeerHealthCardProps) {
  const now = Date.now()
  const friend = peer.name?.trim() || "your friend"
  const status = derivePeerStatus(peer, now)
  const errorTitle = humanizePeerError(peer.remoteLastError, friend)
  const kind = peerKindLabel(peer)
  const active = peer.status === "active"

  const usedPct = percentUsed(peer.usedBytes, peer.quotaBytes)
  const remoteUsed =
    typeof peer.remoteUsedBytes === "number" && peer.remoteUsedBytes >= 0
      ? peer.remoteUsedBytes
      : null
  const remoteQuota =
    typeof peer.remoteQuotaBytes === "number" && peer.remoteQuotaBytes > 0
      ? peer.remoteQuotaBytes
      : peer.quotaBytes
  const remotePct =
    remoteUsed !== null ? percentUsed(remoteUsed, remoteQuota) : 0

  const pendingCount = peer.pendingSyncCount ?? 0
  const pendingBytes =
    typeof peer.pendingBytes === "number" && peer.pendingBytes > 0
      ? peer.pendingBytes
      : null
  const lastSeen = formatRelativeTime(peer.lastSeenAt, now)
  const pendingAge = formatRelativeTime(peer.oldestPendingAt, now)
  const storedAt = formatStoredAt(peer.remoteLastSyncAt)
  const lastSeenAbsolute = peer.lastSeenAt
    ? new Date(peer.lastSeenAt).toLocaleString()
    : undefined

  const [renameOpen, setRenameOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState(peer.name)
  const [renaming, setRenaming] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [revokeFallback, setRevokeFallback] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revoking, setRevoking] = useState(false)

  const openRename = () => {
    setNameDraft(peer.name)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    const next = nameDraft.trim()
    if (!next) {
      toast.error("Enter a name for this friend.")
      return
    }
    if (next === peer.name) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    try {
      await onRename(peer.id, next)
      setRenameOpen(false)
    } catch {
      // toast in usePeers
    } finally {
      setRenaming(false)
    }
  }

  const confirmRemove = async () => {
    setRemoving(true)
    try {
      await onRemove(peer.id)
      setRemoveOpen(false)
      setRevokeFallback(false)
    } catch {
      setRemoveOpen(false)
      setRevokeFallback(Boolean(onRevoke))
    } finally {
      setRemoving(false)
    }
  }

  const confirmRevoke = async () => {
    if (!onRevoke) return
    setRevoking(true)
    try {
      await onRevoke(peer.id)
      setRevokeOpen(false)
    } catch {
      // toast in usePeers
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{friend}</h3>
            <Badge variant="secondary" className="font-normal">
              {kind}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {active
              ? "Backups are encrypted before they leave this machine."
              : "This connection is disconnected. Files already on their disk remain there."}
          </p>
        </div>

        <span
          title={lastSeenAbsolute}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
            TONE_BADGE[status.tone]
          )}
        >
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[status.tone])}
          />
          {status.label}
        </span>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5">
              <HardDriveIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Space {friend} uses on this disk
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBytesShort(peer.usedBytes)} of{" "}
              {formatBytesShort(peer.quotaBytes)}
            </span>
          </div>
          <Progress
            value={usedPct}
            aria-label={`Space ${friend} uses on this disk`}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5">
              <UploadIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Your backups on {friend}’s disk
            </span>
            {remoteUsed !== null ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatBytesShort(remoteUsed)} of{" "}
                {formatBytesShort(remoteQuota)}
              </span>
            ) : null}
          </div>
          {remoteUsed !== null ? (
            <Progress
              value={remotePct}
              aria-label={`Your backups on ${friend}’s disk`}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for {friend}’s app to report.
            </p>
          )}
          {storedAt ? (
            <p className="text-xs text-muted-foreground">
              Last backup stored on {friend}: {storedAt}
            </p>
          ) : null}
        </div>
      </div>

      {errorTitle ? (
        <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription className="text-destructive/90">
            <p>
              {friend}’s LazyBro reported a problem. Backups stay on this server
              until it is fixed.
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs underline underline-offset-2">
                Details
              </summary>
              <p className="mt-1 break-words text-xs">{peer.remoteLastError}</p>
            </details>
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingCount > 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <ClockIcon className="h-4 w-4" />
          <AlertTitle>
            {pendingCount} backup{pendingCount === 1 ? "" : "s"} waiting to
            upload
          </AlertTitle>
          <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
            <p>
              {pendingBytes
                ? `${formatBytesShort(pendingBytes)} waiting. `
                : ""}
              {lastSeen === "just now"
                ? `${friend}’s app checked in just now.`
                : lastSeen
                  ? `${friend}’s app last checked in ${lastSeen}.`
                  : `${friend}’s app hasn’t connected yet.`}
            </p>
            {pendingAge ? (
              <p>
                The oldest has been waiting for{" "}
                {pendingAge.replace(/ ago$/, "")}.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {active ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/backups/new?peerId=${encodeURIComponent(peer.id)}`}>
              Back up to {friend}
            </Link>
          </Button>
        ) : (
          <span />
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex">
          {active ? (
            <Button type="button" variant="outline" onClick={openRename}>
              <PencilIcon className="h-4 w-4" />
              Rename
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2Icon className="h-4 w-4" />
            Remove
          </Button>
          {revokeFallback && onRevoke && active ? (
            <Button
              type="button"
              variant="outline"
              className="col-span-2 border-destructive/40 text-destructive hover:text-destructive sm:col-span-1"
              onClick={() => setRevokeOpen(true)}
            >
              Revoke access
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {friend}</DialogTitle>
            <DialogDescription>
              This name is only shown on this LazyBackup. It doesn’t change what
              your friend sees.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`peer-name-${peer.id}`}>Friend’s name</Label>
            <Input
              id={`peer-name-${peer.id}`}
              value={nameDraft}
              maxLength={80}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void submitRename()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="button"
              isLoading={renaming}
              loadingText="Saving…"
              onClick={() => void submitRename()}
              disabled={!nameDraft.trim()}
            >
              Save name
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {friend}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their LazyBro will stop sending backups. Files already on their
              disk stay there until they delete them. Backups that point to{" "}
              {friend} will be turned off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmRemove()
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access for {friend}?</AlertDialogTitle>
            <AlertDialogDescription>
              Backups to this friend will stop. Staged data stays on this server
              until the friend is removed. Their app will show a disconnected
              state on its next check-in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmRevoke()
              }}
            >
              {revoking ? "Revoking…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
