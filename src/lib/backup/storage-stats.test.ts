import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import {
  STORAGE_STATS_TTL_MS,
  VERSION_DIR_PATTERN,
  clearBackupStorageStatsCache,
  getCachedBackupStorageStats,
  markBackupStorageStatsDirty,
  resolveLocalBackupPath,
} from "./storage-stats"

describe("VERSION_DIR_PATTERN", () => {
  test("matches version folder names", () => {
    expect(VERSION_DIR_PATTERN.test("2026-08-07_23-15-01")).toBe(true)
    expect(VERSION_DIR_PATTERN.test("2026-08-07_23-15-01-2")).toBe(true)
    expect(VERSION_DIR_PATTERN.test("2026-08-07_23-15-01-10")).toBe(true)
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

describe("getCachedBackupStorageStats", () => {
  let root: string
  const previousRoot = process.env.BACKUP_STORAGE_PATH

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lb-storage-stats-"))
    await writeFile(join(root, "a.txt"), "a")
    process.env.BACKUP_STORAGE_PATH = root
    clearBackupStorageStatsCache()
  })

  afterEach(async () => {
    clearBackupStorageStatsCache()
    if (previousRoot === undefined) delete process.env.BACKUP_STORAGE_PATH
    else process.env.BACKUP_STORAGE_PATH = previousRoot
    await rm(root, { recursive: true, force: true })
  })

  test("serves the cached walk within the TTL", async () => {
    expect((await getCachedBackupStorageStats()).fileCount).toBe(1)
    await writeFile(join(root, "b.txt"), "b")
    expect((await getCachedBackupStorageStats()).fileCount).toBe(1)
  })

  test("re-walks after a backup marks the cache dirty", async () => {
    await getCachedBackupStorageStats()
    await writeFile(join(root, "b.txt"), "b")
    markBackupStorageStatsDirty()
    expect((await getCachedBackupStorageStats()).fileCount).toBe(2)
  })

  test("returns stale stats at once and refreshes in the background", async () => {
    await getCachedBackupStorageStats()
    await writeFile(join(root, "b.txt"), "b")
    const later = Date.now() + STORAGE_STATS_TTL_MS + 1
    expect((await getCachedBackupStorageStats(later)).fileCount).toBe(1)

    let fileCount = 1
    for (let i = 0; i < 50 && fileCount === 1; i++) {
      await Bun.sleep(10)
      fileCount = (await getCachedBackupStorageStats()).fileCount
    }
    expect(fileCount).toBe(2)
  })

  test("concurrent callers share one walk", async () => {
    const [a, b] = await Promise.all([
      getCachedBackupStorageStats(),
      getCachedBackupStorageStats(),
    ])
    expect(a).toBe(b)
  })
})
