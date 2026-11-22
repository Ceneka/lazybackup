"use client"

import { Button } from "@/components/ui/button"
import { detailActionGhostClassName } from "@/components/ui/detail-actions"
import { readApiError } from "@/lib/api/client-error"
import {
  canDownloadBackup,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
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
  const [waiting, setWaiting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)
  const checkingRef = useRef(false)
  const waitingNotifiedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

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
    try {
      const res = await fetch(href, {
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
        return "error"
      }
      // A login redirect (or proxy error page) would otherwise be saved as HTML.
      const contentType = res.headers.get("content-type") || ""
      if (contentType.includes("text/html")) {
        toast.error("Download unavailable — sign in again and retry")
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
      const first = await tryOnce()
      if (first !== "waiting") return
      setWaiting(true)
      if (pollRef.current) return
      pollRef.current = setInterval(() => {
        if (inFlightRef.current) return
        inFlightRef.current = true
        void tryOnce()
          .then((result) => {
            if (result === "waiting") return
            stopPolling()
            setWaiting(false)
          })
          .finally(() => {
            inFlightRef.current = false
          })
      }, 3000)
    } finally {
      checkingRef.current = false
    }
  }

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClick}
          disabled={waiting}
          title={waiting ? "Waiting for Bro — cancel to stop" : title}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {waiting ? "Waiting for Bro" : inlineLabel}
        </Button>
        {waiting ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelWaiting}
          >
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
        className={cn(detailActionGhostClassName, className, waiting && "opacity-70")}
        onClick={handleClick}
        aria-disabled={waiting || undefined}
        title={waiting ? "Waiting for Bro — cancel to stop" : title}
      >
        <DownloadIcon />
        <span>{waiting ? "Waiting for Bro" : label}</span>
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
