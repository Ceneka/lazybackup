"use client"

import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

/** Copy + toast, using the secure-context fallback from `lib/clipboard`. */
export async function copyText(value: string, label: string): Promise<boolean> {
  const ok = await copyToClipboard(value)
  if (ok) {
    toast.success(`${label} copied`)
  } else {
    toast.error("Could not copy — select the text and copy manually")
  }
  return ok
}

type CopyButtonProps = {
  value: string
  /** Used in the toast and accessible name, e.g. "Token". */
  label: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
  /** Hide the visible label, keep an aria-label (for icon-only rows). */
  iconOnly?: boolean
  onCopied?: () => void
}

export function CopyButton({
  value,
  label,
  variant = "outline",
  size = "sm",
  className,
  iconOnly = false,
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    const ok = await copyText(value, label)
    if (!ok) return
    setCopied(true)
    onCopied?.()
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      aria-label={iconOnly ? (copied ? "Copied" : `Copy ${label}`) : undefined}
      title={iconOnly ? (copied ? "Copied" : `Copy ${label}`) : undefined}
      onClick={() => void handleCopy()}
    >
      {copied ? (
        <CheckIcon className={cn("h-4 w-4", !iconOnly && "mr-2")} aria-hidden />
      ) : (
        <CopyIcon className={cn("h-4 w-4", !iconOnly && "mr-2")} aria-hidden />
      )}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  )
}
