import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Progress } from "./progress"

describe("Progress accessibility", () => {
  test("forwards the value to Radix so assistive tech can read the percentage", () => {
    const html = renderToStaticMarkup(
      createElement(Progress, { value: 42, "aria-label": "Used space" })
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).toContain('aria-label="Used space"')
  })
})
