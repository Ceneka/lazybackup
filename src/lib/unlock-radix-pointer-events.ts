/**
 * Radix modal layers can leave pointer-events: none on body/html or orphaned
 * full-screen overlays after close — especially during route transitions.
 * Also clears react-remove-scroll leftovers (data-scroll-locked / padding).
 */
export function unlockRadixPointerEvents() {
  if (typeof document === "undefined") return

  const openModal = document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
  )

  if (openModal) return

  document.body.style.removeProperty("pointer-events")
  document.documentElement.style.removeProperty("pointer-events")

  // react-remove-scroll (used by Radix) can leave these behind
  document.body.removeAttribute("data-scroll-locked")
  document.body.style.removeProperty("padding-right")
  document.body.style.removeProperty("margin-right")
  document.body.style.removeProperty("overflow")

  // Closed dialog/sheet overlays that still sit in the DOM after animation
  document
    .querySelectorAll(
      '[data-slot="alert-dialog-overlay"][data-state="closed"], [data-slot="sheet-overlay"][data-state="closed"]'
    )
    .forEach((el) => el.remove())

  // Lingering select/popper wrappers with no open content
  document.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((el) => {
    const open = el.querySelector('[data-state="open"]')
    if (!open) el.remove()
  })
}

export function scheduleUnlockRadixPointerEvents(delayMs = 150) {
  setTimeout(unlockRadixPointerEvents, delayMs)
}
