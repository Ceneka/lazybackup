/**
 * Copy text to the clipboard with a fallback for insecure contexts.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or localhost).
 * LazyBackup is often opened over plain HTTP on a LAN/Tailscale address, where
 * that API is unavailable, so fall back to a hidden textarea +
 * `document.execCommand("copy")`.
 *
 * Never throws: resolves to `true` on success and `false` when copying is not
 * possible (SSR, permissions denied, unsupported browser).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      // Permission denied or clipboard busy — try the legacy path below.
    }
  }

  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false
  }

  const previouslyFocused = document.activeElement as HTMLElement | null
  let textarea: HTMLTextAreaElement | null = null

  try {
    textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.setAttribute("aria-hidden", "true")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.width = "1px"
    textarea.style.height = "1px"
    textarea.style.padding = "0"
    textarea.style.border = "none"
    textarea.style.outline = "none"
    textarea.style.boxShadow = "none"
    textarea.style.background = "transparent"
    textarea.style.opacity = "0"
    // 16px keeps iOS Safari from zooming while the field is focused.
    textarea.style.fontSize = "16px"

    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea?.remove()
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus({ preventScroll: true })
    }
  }
}
