"use client"

import { scheduleUnlockRadixPointerEvents, unlockRadixPointerEvents } from "@/lib/unlock-radix-pointer-events"
import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect } from "react"

/**
 * Guards against Radix UI leaving pointer-events: none on body after Sheet/Dialog/Select closes.
 * Uses MutationObserver so a stuck inline style is cleared immediately, not only on an interval.
 */
export function BodyPointerEventsGuard() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    unlockRadixPointerEvents()
  }, [pathname])

  useEffect(() => {
    unlockRadixPointerEvents()
    scheduleUnlockRadixPointerEvents()
    return () => scheduleUnlockRadixPointerEvents()
  }, [pathname])

  useEffect(() => {
    const unlock = () => unlockRadixPointerEvents()

    const observer = new MutationObserver(unlock)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "data-scroll-locked"],
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })

    // Catch select/dialog portals that linger after close
    const portalObserver = new MutationObserver(() => {
      scheduleUnlockRadixPointerEvents(50)
    })
    portalObserver.observe(document.body, { childList: true, subtree: true })

    const onVis = () => {
      if (document.visibilityState === "visible") unlock()
    }
    window.addEventListener("focus", unlock)
    document.addEventListener("visibilitychange", onVis)
    // Capture-phase pointerdown: if UI is frozen, first interaction clears the lock
    window.addEventListener("pointerdown", unlock, true)

    const id = window.setInterval(unlock, 1000)

    return () => {
      observer.disconnect()
      portalObserver.disconnect()
      window.removeEventListener("focus", unlock)
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pointerdown", unlock, true)
      clearInterval(id)
    }
  }, [])

  return null
}
