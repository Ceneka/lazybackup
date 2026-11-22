"use client"

import { cn } from "@/lib/utils"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useState, type InputHTMLAttributes } from "react"

/** Shared input chrome for the connection forms. */
export const connectionInputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Password/secret input with a show/hide toggle. Keeps `autoComplete` and all
 * other input props untouched; only the rendered `type` changes.
 */
export function PasswordInput({
  className,
  revealLabel = "value",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { revealLabel?: string }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cn(connectionInputClass, "pr-10", className)}
      />
      <button
        type="button"
        aria-label={`${visible ? "Hide" : "Show"} ${revealLabel}`}
        aria-pressed={visible}
        title={visible ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => setVisible((open) => !open)}
      >
        {visible ? (
          <EyeOffIcon className="h-4 w-4" aria-hidden />
        ) : (
          <EyeIcon className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

/** Inline validation message under a field. */
export function FieldError({
  id,
  message,
}: {
  id?: string
  message?: string | null
}) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-sm text-destructive">
      {message}
    </p>
  )
}
