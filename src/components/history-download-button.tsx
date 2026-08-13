"use client"

import { detailActionGhostClassName } from "@/components/ui/detail-actions"
import { Button } from "@/components/ui/button"
import { canDownloadBackup } from "@/lib/backup/restore-eligibility"
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
  const eligible = canDownloadBackup({
    status: entry.status,
    sourceType: entry.backupConfig?.sourceType,
    destinationKind: entry.backupConfig?.destinationKind,
    artifactPath: entry.artifactPath,
  })
  const [waiting, setWaiting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

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

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault()
    const tryOnce = async (): Promise<"ok" | "waiting" | "error"> => {
      const res = await fetch(href)
      if (res.status === 202) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        toast.message(data.message || PEER_RECALL_WAITING_MESSAGE)
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
    } catch (error) {
      stopPolling()
      setWaiting(false)
      toast.error(error instanceof Error ? error.message : "Failed to download artifact")
    }
  }

  const label = waiting ? PEER_RECALL_WAITING_MESSAGE : "Download"

  if (variant === "inline") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={handleClick}
        disabled={waiting}
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {waiting ? "Waiting for Bro" : "Download"}
      </Button>
    )
  }

  return (
    <a
      href={href}
      className={cn(detailActionGhostClassName, className, waiting && "pointer-events-none opacity-70")}
      onClick={handleClick}
      title={waiting ? label : undefined}
    >
      <DownloadIcon />
      {waiting ? "Waiting for Bro" : "Download"}
    </a>
  )
}
