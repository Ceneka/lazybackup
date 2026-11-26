"use client"

import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  LAZYBRO_DOWNLOADS,
  LAZYBRO_RELEASE_URL,
} from "@/lib/bro/download-links"

/**
 * The friend needs the LazyBro binary before they can paste the invite.
 * Keep this next to the invite message so the host can send one link too.
 */
export function LazyBroDownloadLinks() {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Download LazyBro</h4>
        <a
          href={LAZYBRO_RELEASE_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline underline-offset-4 hover:no-underline"
        >
          All downloads
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LAZYBRO_DOWNLOADS.map((download) => (
          <Button
            key={download.id}
            asChild
            variant="outline"
            size="sm"
            className="justify-start"
          >
            <a href={download.url} target="_blank" rel="noreferrer">
              <DownloadIcon className="h-4 w-4" />
              <span className="truncate">{download.label}</span>
            </a>
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Your friend opens LazyBro and pastes the invite above. No account
        needed.
      </p>
    </div>
  )
}
