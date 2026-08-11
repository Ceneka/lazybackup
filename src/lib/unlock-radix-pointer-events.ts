/**
 * Radix modal layers can leave pointer-events: none on body/html after close —
 * especially during route transitions. Also clears react-remove-scroll leftovers
 * (data-scroll-locked / padding).
 *
 * Do NOT imperatively remove portal/overlay nodes here: React still owns them and
 * will throw NotFoundError (removeChild) when it later unmounts the same nodes.
 * Stuck overlays are handled via CSS (data-[state=closed]:pointer-events-none)
 * and body/html pointer-events: auto !important in globals.css.
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
}

export function scheduleUnlockRadixPointerEvents(delayMs = 150) {
  setTimeout(unlockRadixPointerEvents, delayMs)
}
