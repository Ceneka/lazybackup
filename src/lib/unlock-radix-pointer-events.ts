/**
 * Radix modal layers can leave pointer-events: none on body/html or orphaned
 * full-screen overlays after close — especially during route transitions.
 */
export function unlockRadixPointerEvents() {
  if (typeof document === "undefined") return

  const openModal = document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
  )

  if (!openModal) {
    document.body.style.removeProperty("pointer-events")
    document.documentElement.style.removeProperty("pointer-events")

    document
      .querySelectorAll(
        '[data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"]'
      )
      .forEach((el) => {
        if (el.getAttribute("data-state") === "closed") {
          el.remove()
        }
      })
  }
}

export function scheduleUnlockRadixPointerEvents(delayMs = 150) {
  setTimeout(unlockRadixPointerEvents, delayMs)
}
