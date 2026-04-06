"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

/**
 * Guards against Radix UI bug where pointer-events: none persists on body
 * after Sheet/Dialog/AlertDialog closes, making the page unclickable.
 * Resets body styles on route change as a safety net.
 */
export function BodyPointerEventsGuard() {
  const pathname = usePathname()

  useEffect(() => {
    const timer = setTimeout(() => {
      if (document.body.style.pointerEvents === "none") {
        document.body.style.removeProperty("pointer-events")
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [pathname])

  return null
}
