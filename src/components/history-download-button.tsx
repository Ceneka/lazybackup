"use client"

import { detailActionGhostClassName } from "@/components/ui/detail-actions"
import { Button } from "@/components/ui/button"
import { canDownloadBackup } from "@/lib/backup/restore-eligibility"
import { cn } from "@/lib/utils"
import { DownloadIcon } from "lucide-react"
import type { HistoryRestoreEntry } from "@/components/history-restore-button"

type HistoryDownloadButtonProps = {
  entry: HistoryRestoreEntry
  /** Detail page tile vs compact list control */
  variant?: "detail" | "inline"
  className?: string
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

  if (!eligible) {
    return null
  }

  const href = `/api/history/${entry.id}/download`

  if (variant === "inline") {
    return (
      <Button type="button" variant="ghost" size="sm" className={className} asChild>
        <a href={href}>
          <DownloadIcon className="h-3.5 w-3.5" />
          Download
        </a>
      </Button>
    )
  }

  return (
    <a href={href} className={cn(detailActionGhostClassName, className)}>
      <DownloadIcon />
      Download
    </a>
  )
}
