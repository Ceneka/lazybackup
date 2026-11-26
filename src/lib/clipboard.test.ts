import { describe, expect, test } from "bun:test"
import { copyText, type ClipboardDocument } from "./clipboard"

function fakeDocument(options: {
  execResult?: boolean
  throwOnExec?: boolean
}): {
  doc: ClipboardDocument
  textarea: {
    value: string
    selected: boolean
    removed: boolean
    style: Record<string, string>
    setAttribute: (name: string, value: string) => void
    focus: () => void
    select: () => void
    setSelectionRange: (start: number, end: number) => void
  }
  appended: () => number
} {
  const textarea = {
    value: "",
    selected: false,
    removed: false,
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => {
      textarea.selected = true
    },
    setSelectionRange: () => {},
  }
  let appended = 0
  const doc: ClipboardDocument = {
    createElement: () => textarea,
    body: {
      appendChild: () => {
        appended += 1
      },
      removeChild: () => {
        textarea.removed = true
      },
    },
    execCommand: () => {
      if (options.throwOnExec) throw new Error("execCommand blocked")
      return options.execResult ?? false
    },
  }
  return { doc, textarea, appended: () => appended }
}

describe("copyText", () => {
  test("uses the async Clipboard API when available", async () => {
    let copied = ""
    const ok = await copyText("hello", {
      clipboard: {
        writeText: async (text) => {
          copied = text
        },
      },
      document: null,
    })
    expect(ok).toBe(true)
    expect(copied).toBe("hello")
  })

  test("falls back to execCommand on plain HTTP (clipboard undefined)", async () => {
    const { doc, textarea, appended } = fakeDocument({ execResult: true })
    const ok = await copyText("lb1.invite", { clipboard: null, document: doc })

    expect(ok).toBe(true)
    expect(appended()).toBe(1)
    expect(textarea.value).toBe("lb1.invite")
    expect(textarea.selected).toBe(true)
    expect(textarea.removed).toBe(true)
  })

  test("falls back when the Clipboard API rejects", async () => {
    const { doc, textarea } = fakeDocument({ execResult: true })
    const ok = await copyText("invite", {
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError")
        },
      },
      document: doc,
    })
    expect(ok).toBe(true)
    expect(textarea.value).toBe("invite")
  })

  test("returns false when both paths fail", async () => {
    const { doc } = fakeDocument({ execResult: false })
    expect(await copyText("invite", { clipboard: null, document: doc })).toBe(
      false
    )
  })

  test("returns false instead of throwing when execCommand throws", async () => {
    const { doc } = fakeDocument({ throwOnExec: true })
    expect(await copyText("invite", { clipboard: null, document: doc })).toBe(
      false
    )
  })

  test("returns false for empty text and missing dependencies", async () => {
    expect(await copyText("", { clipboard: null, document: null })).toBe(false)
    expect(await copyText("invite", { clipboard: null, document: null })).toBe(
      false
    )
  })
})
