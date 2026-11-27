"use client"

import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import {
  CheckCircle2Icon,
  ClipboardIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

export type ConnectionTestOutcome = {
  success: boolean
  /** Detail from the API — shown once and copied by "Copy error". */
  message?: string
  /** Epoch milliseconds; rendered as a local time after the test finishes. */
  testedAt?: number
  /** What was tested, e.g. "Current form values · root@example.com:22". */
  testedLabel?: string
}

const toneClass = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
} as const

type Tone = keyof typeof toneClass

/**
 * Persistent "last test" panel shared by server/S3/Git detail pages and forms.
 * Success and failure look the same everywhere, the result stays on screen,
 * and a failure can be copied without retyping it.
 */
export function ConnectionTestResultPanel({
  result,
  title,
  details,
  warning,
  showMessage = true,
  onRetry,
  retrying = false,
  className,
}: {
  result: ConnectionTestOutcome
  /** Override the default "Connection OK" / "Connection failed". */
  title?: string
  /** Extra rows rendered under the message (transport, Docker, refs…). */
  details?: ReactNode
  /** Extra caveat such as the password-auth warning. */
  warning?: ReactNode
  /** Hide the API message on success when `details` already covers it. */
  showMessage?: boolean
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const heading =
    title ?? (result.success ? "Connection OK" : "Connection failed")
  const message = showMessage ? result.message : undefined
  const copyText = !result.success
    ? [heading, result.message].filter(Boolean).join("\n")
    : undefined

  async function handleCopy() {
    if (!copyText) return
    const ok = await copyToClipboard(copyText)
    if (ok) {
      setCopied(true)
      toast.success("Error copied")
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error("Could not copy — select the text and copy manually")
    }
  }

  return (
    <div
      role={result.success ? "status" : "alert"}
      aria-live="polite"
      className={cn(
        "rounded-md border p-3 text-sm",
        result.success
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-destructive/40 bg-destructive/10",
        className
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        {result.success ? (
          <CheckCircle2Icon
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        ) : (
          <XCircleIcon
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className={cn(
              "font-medium",
              result.success
                ? "text-emerald-800 dark:text-emerald-200"
                : "text-destructive"
            )}
          >
            {heading}
          </p>
          {result.testedLabel || result.testedAt ? (
            <p className="text-xs text-muted-foreground">
              {result.testedLabel}
              {result.testedLabel && result.testedAt ? " · " : null}
              {result.testedAt
                ? `tested ${new Date(result.testedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : null}
            </p>
          ) : null}
          {message ? (
            <p className="break-words text-muted-foreground">{message}</p>
          ) : null}
          {details}
          {warning ? <div className="pt-1">{warning}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!result.success && copyText ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void handleCopy()}
            >
              <ClipboardIcon className="h-3.5 w-3.5" aria-hidden />
              {copied ? "Copied" : "Copy error"}
            </Button>
          ) : null}
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={retrying}
              onClick={onRetry}
            >
              <RefreshCwIcon
                className={cn("h-3.5 w-3.5", retrying && "animate-spin")}
                aria-hidden
              />
              {retrying ? "Testing…" : "Test again"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ConnectionTestDetail({
  label,
  value,
  tone = "muted",
}: {
  label: string
  value: ReactNode
  tone?: Tone
}) {
  return (
    <p className="text-sm">
      <span className="font-medium text-foreground">{label}: </span>
      <span className={toneClass[tone]}>{value}</span>
    </p>
  )
}

/** Transport + Docker rows shared by the server create/edit/test screens. */
export function ServerTransportDetails({
  result,
}: {
  result: {
    rsyncAvailable: boolean
    scpAvailable: boolean
    dockerAvailable?: boolean
  }
}) {
  return (
    <div className="space-y-1 pt-1">
      <ConnectionTestDetail
        label="rsync on remote"
        tone={result.rsyncAvailable ? "ok" : "muted"}
        value={
          result.rsyncAvailable
            ? "present — backups will use this"
            : "not found"
        }
      />
      <ConnectionTestDetail
        label="SCP on this host"
        tone={
          result.scpAvailable ? (result.rsyncAvailable ? "muted" : "warn") : "muted"
        }
        value={
          result.scpAvailable
            ? result.rsyncAvailable
              ? "available (not used while rsync is present)"
              : "present — backups will use this (rsync unavailable)"
            : "not found"
        }
      />
      <ConnectionTestDetail
        label="Docker on remote"
        tone={result.dockerAvailable ? "ok" : "warn"}
        value={
          result.dockerAvailable
            ? "present — volume backups available"
            : "not found — volume backups unavailable"
        }
      />
    </div>
  )
}
