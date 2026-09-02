"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { APP_VERSION } from "@/lib/app-version"
import { useAppVersion } from "@/lib/hooks/useAppVersion"
import { DownloadIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

function filenameFromDisposition(header: string | null): string {
  if (!header) return "lazybackup-config.json"
  const quoted = header.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1]
  const plain = header.match(/filename=([^;]+)/i)
  return plain?.[1]?.trim() || "lazybackup-config.json"
}

async function saveJsonDownload(res: Response) {
  const blob = await res.blob()
  const name = filenameFromDisposition(res.headers.get("Content-Disposition"))
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function ConfigExportCard() {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch("/api/settings/export")
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error || "Failed to export configuration")
        return
      }
      await saveJsonDownload(res)
      toast.success("Downloaded lazybackup-config.json")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export configuration")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Export configuration</CardTitle>
        <CardDescription>
          Download a non-secret snapshot of servers, backups, and settings.
          Passwords, SSH keys, S3 keys, and token hashes are omitted. There is no
          import in this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoadingButton
          type="button"
          variant="outline"
          onClick={() => void handleDownload()}
          isLoading={downloading}
          loadingText="Preparing…"
        >
          <DownloadIcon className="h-4 w-4" />
          Download config.json
        </LoadingButton>
      </CardContent>
    </Card>
  )
}

export function AppVersionFooter() {
  const query = useAppVersion()
  const info = query.data
  const showUpdate =
    Boolean(info?.updateAvailable && info.htmlUrl && info.status === "ok")

  return (
    <p className="flex flex-wrap items-center justify-center gap-2 pt-2 text-center text-xs text-muted-foreground">
      <span>LazyBackup v{APP_VERSION}</span>
      {showUpdate && (
        <a
          href={info!.htmlUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-800 hover:bg-sky-500/20 dark:text-sky-300"
        >
          Update available
          {info?.latest ? ` · v${info.latest}` : ""}
        </a>
      )}
    </p>
  )
}
