"use client"

import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect } from "react"

/**
 * Radix modal dialogs/sheets set document.body.style.pointerEvents = "none".
 * A known cleanup-order bug can leave it stuck after close so nothing is clickable
 * (and keyboard activation on links can fail). Clear when no dialog is open.
 */
function unlockBodyIfNoRadixModalOpen() {
  if (typeof document === "undefined") return
  const openModal = document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
  )
  if (!openModal && document.body.style.pointerEvents === "none") {
    document.body.style.removeProperty("pointer-events")
  }
}

/**
 * Guards against Radix UI leaving pointer-events: none on body after Sheet/Dialog closes.
 */
export function BodyPointerEventsGuard() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    document.body.style.removeProperty("pointer-events")
  }, [pathname])

  useEffect(() => {
    unlockBodyIfNoRadixModalOpen()
    const timer = setTimeout(unlockBodyIfNoRadixModalOpen, 150)
    return () => clearTimeout(timer)
  }, [pathname])

  useEffect(() => {
    const id = window.setInterval(unlockBodyIfNoRadixModalOpen, 400)
    return () => clearInterval(id)
  }, [])

  return null
}
