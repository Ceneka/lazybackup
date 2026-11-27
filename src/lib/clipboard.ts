/**
 * Clipboard helper that survives plain-HTTP LAN installs.
 *
 * `navigator.clipboard` is only defined in secure contexts (HTTPS or localhost).
 * On `http://192.168.x.x` it is `undefined`, which used to throw and copy
 * nothing. We fall back to the old hidden-textarea + `execCommand("copy")`
 * path and return `false` when the browser blocks both, so callers can show a
 * selectable textarea instead of claiming success.
 *
 * `copyToClipboard` is a drop-in alias used by the settings/connections UI.
 */

export type ClipboardDeps = {
  clipboard?: { writeText?: (text: string) => Promise<void> } | null
  document?: ClipboardDocument | null
}

type ClipboardTextArea = {
  value: string
  style: Record<string, string>
  setAttribute: (name: string, value: string) => void
  focus: () => void
  select: () => void
  setSelectionRange?: (start: number, end: number) => void
}

export type ClipboardDocument = {
  createElement: (tagName: string) => ClipboardTextArea
  body: {
    appendChild: (node: ClipboardTextArea) => void
    removeChild: (node: ClipboardTextArea) => void
  } | null
  execCommand?: (command: string) => boolean
}

function defaultDeps(): ClipboardDeps {
  const nav = typeof navigator === "undefined" ? null : navigator
  const doc = typeof document === "undefined" ? null : document
  return {
    clipboard: nav?.clipboard ?? null,
    document: (doc as unknown as ClipboardDocument | null) ?? null,
  }
}

async function copyWithClipboardApi(
  text: string,
  clipboard: ClipboardDeps["clipboard"]
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function copyWithExecCommand(
  text: string,
  doc: ClipboardDeps["document"]
): boolean {
  if (!doc || typeof doc.createElement !== "function" || !doc.body) return false
  if (typeof doc.execCommand !== "function") return false

  let textarea: ClipboardTextArea | null = null
  try {
    textarea = doc.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "-9999px"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    doc.body.appendChild(textarea)
    textarea.focus()
    if (typeof textarea.setSelectionRange === "function") {
      textarea.setSelectionRange(0, text.length)
    }
    textarea.select()
    return doc.execCommand("copy") === true
  } catch {
    return false
  } finally {
    if (textarea) {
      try {
        doc.body?.removeChild(textarea)
      } catch {
        // best effort cleanup
      }
    }
  }
}

/**
 * Copy `text` and report whether it really worked.
 *
 * Callers must only show a "Copied" toast when this resolves `true`.
 */
export async function copyText(
  text: string,
  deps: ClipboardDeps = defaultDeps()
): Promise<boolean> {
  const value = text ?? ""
  if (!value) return false

  if (await copyWithClipboardApi(value, deps.clipboard)) return true
  return copyWithExecCommand(value, deps.document)
}

/** Alias kept for call sites that predate `copyText`. */
export const copyToClipboard = copyText
