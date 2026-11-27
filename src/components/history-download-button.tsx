"use client"

import { Button } from "@/components/ui/button"
import { detailActionGhostClassName } from "@/components/ui/detail-actions"
import { readApiError } from "@/lib/api/client-error"
import {
  canDownloadBackup,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { deriveDeliveryState, peerIdForHistoryRow } from "@/lib/backup/delivery-state"
import { usePeers } from "@/lib/hooks/usePeers"
import {
  friendAppKind,
  friendAppLabel,
  friendIsOnline,
  resolveFriendName,
  resolvePeer,
  RECALL_CLOSE_HINT_AFTER_MS,
  restoreWaitingCopy,
  shouldStopRecallPolling,
} from "@/lib/peer/friend-copy"
import { PEER_RECALL_WAITING_MESSAGE } from "@/lib/peer/recall-pending"
import { cn, formatBytes } from "@/lib/utils"
import { DownloadIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { toast } from "sonner"
import type { HistoryRestoreEntry } from "@/components/history-restore-button"

type HistoryDownloadButtonProps = {
  entry: HistoryRestoreEntry
  /** Detail page tile vs compact list control */
  variant?: "detail" | "inline"
  className?: string
}

/**
 * Start a native browser download so the artifact streams to disk with the
 * browser's own progress UI instead of being buffered in memory via res.blob().
 */
function triggerNativeDownload(href: string) {
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = ""
  anchor.rel = "noopener"
  anchor.setAttribute("data-no-nav", "")
  anchor.style.display = "none"
  document.body.appendChild(anchor)
  anchor.click()
  // Some browsers cancel the download if the anchor disappears immediately.
  window.setTimeout(() => anchor.remove(), 1000)
}

export function HistoryDownloadButton({
  entry,
  variant = "detail",
  className,
}: HistoryDownloadButtonProps) {
  const eligible = canDownloadBackup(restoreEligibilityFromHistory(entry))
  const peersQuery = usePeers()
  const peers = peersQuery.data?.peers || []
  const [waiting, setWaiting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)
  const checkingRef = useRef(false)
  const waitingNotifiedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const closeHintShownRef = useRef(false)
  const lastFailedRef = useRef(false)

  // Never leave a 3 s poller (or a surprise download) behind after navigating.
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const peerId = peerIdForHistoryRow({
    artifactPath: entry.artifactPath,
    destinationPeerId: entry.backupConfig?.destinationPeerId,
    destinationPeer: entry.backupConfig?.destinationPeer,
  })
  const peer = resolvePeer(peers, peerId)
  const friendName = resolveFriendName(peers, peerId)
  const friendKind = peer ? friendAppKind(peer) : null
  const friendOnline = friendIsOnline(peer)
  const deliveryState = deriveDeliveryState({
    status: entry.status,
    deliveryState: entry.deliveryState,
    mailboxPending: entry.mailboxPending,
    artifactPath: entry.artifactPath,
    destinationKind: entry.backupConfig?.destinationKind,
  })

  if (!eligible) {
    return null
  }

  const href = `/api/history/${entry.id}/download`
  const encrypted = Boolean(entry.artifactPath?.toLowerCase().endsWith(".age"))
  const sizeLabel = entry.totalSize != null ? formatBytes(entry.totalSize) : null
  const label = encrypted ? "Download encrypted (.age)" : "Download"
  const inlineLabel = encrypted ? "Download encrypted" : "Download"
  const title = encrypted
    ? "Age-encrypted artifact. Restoring on this host decrypts it with the vault key."
    : sizeLabel
      ? `${label} · ${sizeLabel}`
      : label

  const waitingCopy = restoreWaitingCopy({
    friendName,
    kind: friendKind,
    online: friendOnline,
    elapsedMs: 0,
  })

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const cancelWaiting = () => {
    stopPolling()
    abortRef.current?.abort()
    abortRef.current = null
    setWaiting(false)
    inFlightRef.current = false
    waitingNotifiedRef.current = false
    toast.message("Download cancelled — the backup was not retrieved")
  }

  const tryOnce = async (): Promise<"ok" | "waiting" | "error"> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // After a failed attempt the server refuses until the client asks again.
    let retryFailedRecall = lastFailedRef.current
    lastFailedRef.current = false
    const url = retryFailedRecall ? `${href}?retry=1` : href
    retryFailedRecall = false
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      })
      if (res.status === 202) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        if (!waitingNotifiedRef.current) {
          toast.message(data.message || PEER_RECALL_WAITING_MESSAGE)
          waitingNotifiedRef.current = true
        }
        return "waiting"
      }
      if (!res.ok) {
        const { message } = await readApiError(res)
        toast.error(message)
        lastFailedRef.current = true
        return "error"
      }
      // A login redirect (or proxy error page) would otherwise be saved as HTML.
      const contentType = res.headers.get("content-type") || ""
      if (contentType.includes("text/html")) {
        toast.error("Download unavailable — sign in again and retry")
        lastFailedRef.current = true
        return "error"
      }
      // The check request is not needed — let the browser stream it to disk.
      try {
        await res.body?.cancel()
      } catch {
        // The body may already be closed; the native download is what matters.
      }
      if (controller.signal.aborted) return "error"
      triggerNativeDownload(href)
      return "ok"
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(
          error instanceof Error ? error.message : "Failed to download artifact"
        )
        lastFailedRef.current = true
      }
      return "error"
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault()
    if (checkingRef.current || waiting) return
    checkingRef.current = true
    waitingNotifiedRef.current = false
    try {
      if (peerId && friendOnline === false) {
        toast.message(
          `${friendName}'s ${friendAppLabel(friendKind)} is offline.`,
          {
            description:
              "The download will start when their app checks in. The request stays queued if you close this.",
          }
        )
      }
      if (deliveryState === "waiting") {
        toast.message(`This backup hasn't reached ${friendName}'s disk yet.`, {
          description: "The download will wait for it to sync first.",
        })
      }

      const first = await tryOnce()
      if (first === "ok" || first === "error") return
      if (first !== "waiting") return

      toast.info(waitingCopy.headline, {
        description: waitingCopy.detail,
      })
      setWaiting(true)
      startedAtRef.current = Date.now()
      closeHintShownRef.current = false
      if (pollRef.current) return
      pollRef.current = setInterval(() => {
        if (inFlightRef.current) return
        const startedAt = startedAtRef.current ?? Date.now()
        const elapsed = Date.now() - startedAt
        if (elapsed >= RECALL_CLOSE_HINT_AFTER_MS && !closeHintShownRef.current) {
          closeHintShownRef.current = true
          toast.message(
            "You can close this — the request stays queued; check History later."
          )
        }
        if (shouldStopRecallPolling(elapsed)) {
          stopPolling()
          setWaiting(false)
          toast.message(
            `Still waiting for ${friendName}'s ${friendKind === "lazybackup" ? "LazyBackup" : "LazyBro"}.`,
            {
              description:
                "The request stays queued — try Download again later, or check History.",
            }
          )
          return
        }
        inFlightRef.current = true
        void tryOnce()
          .then((result) => {
            if (result === "waiting") return
            stopPolling()
            setWaiting(false)
            if (result === "ok") {
              toast.success("Download ready")
            }
          })
          .catch((error) => {
            stopPolling()
            setWaiting(false)
            toast.error(
              error instanceof Error ? error.message : "Failed to download artifact"
            )
          })
          .finally(() => {
            inFlightRef.current = false
          })
      }, 3000)
    } catch (error) {
      stopPolling()
      setWaiting(false)
      toast.error(
        error instanceof Error ? error.message : PEER_RECALL_WAITING_MESSAGE
      )
    } finally {
      checkingRef.current = false
    }
  }

  const buttonTitle = waiting ? waitingCopy.detail : title

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClick}
          disabled={waiting}
          title={buttonTitle}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {waiting ? `Waiting for ${friendName}` : inlineLabel}
        </Button>
        {waiting ? (
          <Button type="button" variant="ghost" size="sm" onClick={cancelWaiting}>
            <XIcon className="h-3.5 w-3.5" />
            Cancel
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <a
        href={href}
        download=""
        data-no-nav
        className={cn(
          detailActionGhostClassName,
          className,
          waiting && "pointer-events-none opacity-70"
        )}
        onClick={handleClick}
        aria-disabled={waiting || undefined}
        title={buttonTitle}
      >
        <DownloadIcon />
        <span>{waiting ? `Waiting for ${friendName}` : label}</span>
        {!waiting && sizeLabel ? (
          <span className="text-[11px] font-normal text-muted-foreground">
            {sizeLabel}
          </span>
        ) : null}
      </a>
      {waiting ? (
        <Button
          type="button"
          variant="ghost"
          className={detailActionGhostClassName}
          onClick={cancelWaiting}
        >
          <XIcon />
          Cancel
        </Button>
      ) : null}
    </>
  )
}
