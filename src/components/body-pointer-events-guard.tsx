"use client"

import { scheduleUnlockRadixPointerEvents, unlockRadixPointerEvents } from "@/lib/unlock-radix-pointer-events"
import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect } from "react"

/**
 * Guards against Radix UI leaving pointer-events: none on body after Sheet/Dialog/Select closes.
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

    // Only watch body style / scroll lock — not html style.
    // next-themes writes color-scheme on <html>; observing that re-enters unlock
    // on every theme change and used to fight React portals.
    const observer = new MutationObserver(unlock)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "data-scroll-locked"],
    })

    const onVis = () => {
      if (document.visibilityState === "visible") unlock()
    }
    window.addEventListener("focus", unlock)
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pointerdown", unlock, true)

    const id = window.setInterval(unlock, 1000)

    return () => {
      observer.disconnect()
      window.removeEventListener("focus", unlock)
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pointerdown", unlock, true)
      clearInterval(id)
    }
  }, [])

  return null
}
