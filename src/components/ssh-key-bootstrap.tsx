"use client"

import { Button } from "@/components/ui/button"
import {
  GeneratedSSHKey,
  SSHKeyInstallCommand,
  fetchSSHKeyInstallCommand,
  isSystemKeyId,
} from "@/lib/hooks/useSSHKeys"
import { useQueryClient } from "@tanstack/react-query"
import { CheckIcon, ClipboardIcon, KeyRoundIcon, Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type Props = {
  /** Currently selected DB key id (not system:… paths). */
  selectedKeyId?: string
  /** Suggested name when generating (e.g. server name). */
  suggestedName?: string
  /** Called after a key is generated so the parent can select it. */
  onKeyGenerated?: (key: GeneratedSSHKey) => void
}

async function generateSSHKey(name?: string): Promise<GeneratedSSHKey> {
  const response = await fetch("/api/ssh-keys/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || "Failed to generate SSH key")
  }
  return response.json()
}

export function SSHKeyBootstrap({
  selectedKeyId,
  suggestedName,
  onKeyGenerated,
}: Props) {
  const queryClient = useQueryClient()
  const [install, setInstall] = useState<SSHKeyInstallCommand | null>(null)
  const [loadingInstall, setLoadingInstall] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const dbKeyId =
    selectedKeyId && !isSystemKeyId(selectedKeyId) ? selectedKeyId : undefined

  useEffect(() => {
    if (!dbKeyId) {
      setInstall(null)
      return
    }

    // Keep showing the just-generated command for this key without refetching.
    if (install?.id === dbKeyId) {
      return
    }

    let cancelled = false
    setLoadingInstall(true)
    fetchSSHKeyInstallCommand(dbKeyId)
      .then((data) => {
        if (!cancelled) setInstall(data)
      })
      .catch(() => {
        if (!cancelled) setInstall(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingInstall(false)
      })

    return () => {
      cancelled = true
    }
    // Only refetch when the selected key changes; keep a freshly generated command in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKeyId])

  const handleGenerate = async () => {
    const name = suggestedName?.trim()
      ? `LazyBackup · ${suggestedName.trim()}`
      : undefined
    setGenerating(true)
    try {
      const key = await generateSSHKey(name)
      setInstall({
        id: key.id,
        name: key.name,
        publicKey: key.publicKey,
        installCommand: key.installCommand,
      })
      toast.success("SSH key generated — paste the install command on the host")
      queryClient.invalidateQueries({ queryKey: ["ssh-keys"] })
      onKeyGenerated?.(key)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate SSH key")
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!install?.installCommand) return
    try {
      await navigator.clipboard.writeText(install.installCommand)
      setCopied(true)
      toast.success("Install command copied")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy — select the command and copy manually")
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Authorize LazyBackup without sharing your SSH key</p>
          <p className="text-sm text-muted-foreground">
            Generate a dedicated key, then paste the install command on the host (as the SSH user).
            After that, LazyBackup can connect — your personal key stays private.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          disabled={generating}
          onClick={handleGenerate}
        >
          {generating ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <KeyRoundIcon className="mr-2 h-4 w-4" />
              Create key
            </>
          )}
        </Button>
      </div>

      {loadingInstall && !install && (
        <p className="flex items-center text-sm text-muted-foreground">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
          Loading install command…
        </p>
      )}

      {install && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium">
              Run on the host
              {install.name ? (
                <span className="font-normal text-muted-foreground"> · {install.name}</span>
              ) : null}
            </label>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardIcon className="mr-1.5 h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs leading-relaxed break-all whitespace-pre-wrap">
            {install.installCommand}
          </pre>
          <p className="text-xs text-muted-foreground">
            Example: <code className="text-foreground">ssh user@host</code>, paste the command,
            then use &quot;Test Backup Capabilities&quot; here.
          </p>
        </div>
      )}
    </div>
  )
}
