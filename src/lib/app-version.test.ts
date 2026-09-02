import { describe, expect, test } from "bun:test"
import { version } from "../../package.json"
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "./app-version"

describe("app version", () => {
  test("matches root package.json", () => {
    expect(APP_VERSION).toBe(version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  test("exposes product name and description", () => {
    expect(APP_NAME).toBe("LazyBackup")
    expect(APP_DESCRIPTION).toContain("From")
    expect(APP_DESCRIPTION).toContain("S3")
  })
})
