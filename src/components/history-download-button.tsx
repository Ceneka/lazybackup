"use client"

import { detailActionGhostClassName } from "@/components/ui/detail-actions"
import { Button } from "@/components/ui/button"
import { canDownloadBackup, restoreEligibilityFromHistory } from "@/lib/backup/restore-eligibility"
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
import { cn } from "@/lib/utils"
import { DownloadIcon } from "lucide-react"
import { useRef, useState, type MouseEvent } from "react"
import { toast } from "sonner"
import type { HistoryRestoreEntry } from "@/components/history-restore-button"

type HistoryDownloadButtonProps = {
  entry: HistoryRestoreEntry
  /** Detail page tile vs compact list control */
  variant?: "detail" | "inline"
  className?: string
}

function filenameFromDisposition(header: string | null): string {
  if (!header) return "backup"
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      return star[1]
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1]
  const plain = header.match(/filename=([^;]+)/i)
  return plain?.[1]?.trim() || "backup"
}

async function saveBlob(res: Response) {
  const blob = await res.blob()
  const name = filenameFromDisposition(res.headers.get("Content-Disposition"))
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
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
  const startedAtRef = useRef<number | null>(null)
  const closeHintShownRef = useRef(false)

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

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const waitingCopy = restoreWaitingCopy({
    friendName,
    kind: friendKind,
    online: friendOnline,
    elapsedMs: 0,
  })

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault()
    const tryOnce = async (): Promise<"ok" | "waiting" | "error"> => {
      const res = await fetch(href)
      if (res.status === 202) {
        await res.json().catch(() => ({}))
        return "waiting"
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error || "Failed to download artifact")
        return "error"
      }
      await saveBlob(res)
      return "ok"
    }

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
      if (first === "ok") return
      if (first === "error") return
      if (first === "waiting") {
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
          if (
            elapsed >= RECALL_CLOSE_HINT_AFTER_MS &&
            !closeHintShownRef.current
          ) {
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
      }
    } catch (error) {
      stopPolling()
      setWaiting(false)
      toast.error(
        error instanceof Error
          ? error.message
          : PEER_RECALL_WAITING_MESSAGE
      )
    }
  }

  const label = waiting ? `Waiting for ${friendName}` : "Download"
  const title = waiting ? waitingCopy.detail : undefined

  if (variant === "inline") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={handleClick}
        disabled={waiting}
        title={title}
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {label}
      </Button>
    )
  }

  return (
    <a
      href={href}
      className={cn(detailActionGhostClassName, className, waiting && "pointer-events-none opacity-70")}
      onClick={handleClick}
      title={title}
    >
      <DownloadIcon />
      {label}
    </a>
  )
}
