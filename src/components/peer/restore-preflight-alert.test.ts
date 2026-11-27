import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RestorePreflightAlert } from "@/components/history-restore-button"

const offline = {
  tone: "warning" as const,
  title: "Alex's LazyBro is offline.",
  detail: "We'll ask for the backup when LazyBro checks in again.",
  primaryLabel: "Request backup",
}

describe("RestorePreflightAlert", () => {
  test("shows the pre-restore warning before a restore", () => {
    const html = renderToStaticMarkup(
      createElement(RestorePreflightAlert, { preflight: offline, restoredTarget: null })
    )
    expect(html).toContain("Alex&#x27;s LazyBro is offline.")
  })

  test("hides the stale warning once the restore completed", () => {
    const html = renderToStaticMarkup(
      createElement(RestorePreflightAlert, {
        preflight: offline,
        restoredTarget: "/tmp/restored",
      })
    )
    expect(html).toBe("")
  })
})
