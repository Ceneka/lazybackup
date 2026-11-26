"use client"

import { useAuthStatus } from "@/lib/hooks/useAuth"
import { AlertTriangleIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

const DISMISS_KEY = "lazybackup:unprotected-banner-dismissed"

/**
 * Persistent reminder while the instance has no app password / passkey.
 * Dismissal lasts for the browser session only; the banner returns next visit.
 */
export function UnprotectedBanner() {
  const auth = useAuthStatus()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1")
    } catch {
      setDismissed(false)
    }
  }, [])

  const show =
    !dismissed &&
    Boolean(auth.data) &&
    auth.data!.authSetupCompleted &&
    !auth.data!.authEnabled

  if (!show) return null

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // storage may be unavailable (private mode); hide for this render
    }
    setDismissed(true)
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">This LazyBackup is unprotected.</span>{" "}
        Anyone who can reach this address can see your servers and keys. Set a
        password or passkey in{" "}
        <Link href="/settings?tab=general" className="underline hover:no-underline">
          Settings → General → App password
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="rounded p-1 text-muted-foreground hover:bg-amber-500/20 hover:text-foreground"
        aria-label="Dismiss for this session"
        title="Dismiss for this session"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
