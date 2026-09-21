"use client"

import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const NavigationPendingContext = createContext(false)

function isInternalNavigation(anchor: HTMLAnchorElement, current: URL) {
  if (anchor.target && anchor.target !== "_self") return false
  if (anchor.hasAttribute("download")) return false
  const href = anchor.getAttribute("href")
  if (!href || href.startsWith("#")) return false
  const next = new URL(href, current.href)
  if (next.origin !== current.origin) return false
  return next.pathname + next.search !== current.pathname + current.search
}

function NavigationPendingProviderInner({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setPending(false)
  }, [pathname, searchParams])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest("a")
      if (!anchor || !isInternalNavigation(anchor, new URL(window.location.href))) {
        return
      }
      setPending(true)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  return (
    <NavigationPendingContext.Provider value={pending}>
      {children}
    </NavigationPendingContext.Provider>
  )
}

export function NavigationPendingProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <NavigationPendingProviderInner>{children}</NavigationPendingProviderInner>
    </Suspense>
  )
}

export function useNavigationPending() {
  return useContext(NavigationPendingContext)
}

/** Thin bar under the sticky header — immediate feedback on tap. */
export function NavigationProgressBar() {
  const pending = useNavigationPending()
  return (
    <div
      role="progressbar"
      aria-hidden={!pending}
      aria-valuetext={pending ? "Loading page" : undefined}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden",
        pending ? "opacity-100" : "opacity-0"
      )}
    >
      {pending ? (
        <div className="h-full w-1/3 bg-primary motion-safe:animate-[nav-indeterminate_1.1s_ease-in-out_infinite]" />
      ) : null}
    </div>
  )
}

/** Header spinner so mobile still has a cue after the menu sheet closes. */
export function NavigationPendingSpinner({ className }: { className?: string }) {
  const pending = useNavigationPending()
  if (!pending) return null
  return (
    <Loader2Icon
      className={cn("h-4 w-4 animate-spin text-muted-foreground", className)}
      aria-label="Loading page"
    />
  )
}

/**
 * Covers the page body when a route change is slow, so the previous screen
 * does not look stuck after the mobile nav sheet closes.
 */
export function NavigationPendingOverlay() {
  const pending = useNavigationPending()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!pending) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 160)
    return () => window.clearTimeout(timer)
  }, [pending])

  if (!pending || !slow) return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-14 z-[90] flex items-start justify-center bg-background/65 pt-24 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-sm">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    </div>
  )
}
