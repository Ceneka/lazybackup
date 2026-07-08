"use client"

import { scheduleUnlockRadixPointerEvents, unlockRadixPointerEvents } from "@/lib/unlock-radix-pointer-events"
import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect } from "react"

/**
 * Guards against Radix UI leaving pointer-events: none on body after Sheet/Dialog closes.
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
    const id = window.setInterval(unlockRadixPointerEvents, 400)
    return () => clearInterval(id)
  }, [])

  return null
}
