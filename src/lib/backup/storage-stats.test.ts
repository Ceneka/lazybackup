import { describe, expect, test } from "bun:test"
import { VERSION_DIR_PATTERN, resolveLocalBackupPath } from "./storage-stats"

describe("VERSION_DIR_PATTERN", () => {
  test("matches version folder names", () => {
    expect(VERSION_DIR_PATTERN.test("2026-08-07_23-15-01")).toBe(true)
    expect(VERSION_DIR_PATTERN.test("backup")).toBe(false)
    expect(VERSION_DIR_PATTERN.test("2026-08-07")).toBe(false)
  })
})

describe("resolveLocalBackupPath", () => {
  test("resolves absolute paths unchanged", () => {
    expect(resolveLocalBackupPath("/backups/mysite")).toBe("/backups/mysite")
  })

  test("resolves relative paths", () => {
    const resolved = resolveLocalBackupPath("backups/mysite")
    expect(resolved.startsWith("/")).toBe(true)
    expect(resolved.endsWith("backups/mysite")).toBe(true)
  })
})
