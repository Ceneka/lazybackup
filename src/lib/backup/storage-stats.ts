import { resolveLocalBackupPath } from "@/lib/backup/destination"
import { subscribeBackupEvents } from "@/lib/events/backup-events"
import { formatBytes } from "@/lib/utils"
import { readdir, stat } from "fs/promises"
import { join } from "path"
import { VERSION_DIR_PATTERN, compareVersionDirNames } from "@/lib/backup/version-dirs"

export { resolveLocalBackupPath }
export { VERSION_DIR_PATTERN }

export type BackupStorageStats = {
  path: string
  exists: boolean
  totalBytes: number
  totalSize: string
  fileCount: number
  directoryCount: number
  topLevelEntries: number
  latest?: {
    name: string
    path: string
    size: string
    bytes: number
    mtime: string
  } | null
}

export type DestinationEntrySummary = {
  name: string
  type: "file" | "directory"
  bytes: number
  size: string
  fileCount: number
  directoryCount: number
  mtime: string
  isVersionDir: boolean
}

export type BackupDestinationSummary = {
  configuredPath: string
  path: string
  exists: boolean
  /** When true, destination lives on a remote server — local disk walk was skipped */
  remote?: boolean
  remoteServerName?: string | null
  totalBytes: number
  totalSize: string
  fileCount: number
  directoryCount: number
  lastModified: string | null
  truncated: boolean
  versioning: {
    enabled: boolean
    versionsToKeep: number | null
    versionCount: number
    versions: DestinationEntrySummary[]
  }
  topLevel: DestinationEntrySummary[]
}

const DEFAULT_ENTRY_LIMIT = 40

type WalkTotals = {
  bytes: number
  fileCount: number
  directoryCount: number
  latestMtimeMs: number
}

async function walkTotals(dir: string): Promise<WalkTotals> {
  const totals: WalkTotals = {
    bytes: 0,
    fileCount: 0,
    directoryCount: 0,
    latestMtimeMs: 0,
  }

  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          totals.directoryCount += 1
          await walk(fullPath)
        } else if (entry.isFile()) {
          const fileStat = await stat(fullPath)
          totals.fileCount += 1
          totals.bytes += fileStat.size
          if (fileStat.mtimeMs > totals.latestMtimeMs) {
            totals.latestMtimeMs = fileStat.mtimeMs
          }
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  await walk(dir)
  return totals
}

/**
 * Recursively summarize local backup storage (destination path on the app host).
 */
export async function getBackupStorageStats(
  rootPath = process.env.BACKUP_STORAGE_PATH || "./backups"
): Promise<BackupStorageStats> {
  const result: BackupStorageStats = {
    path: rootPath,
    exists: false,
    totalBytes: 0,
    totalSize: formatBytes(0),
    fileCount: 0,
    directoryCount: 0,
    topLevelEntries: 0,
    latest: null,
  }

  let rootStat
  try {
    rootStat = await stat(rootPath)
  } catch {
    return result
  }

  if (!rootStat.isDirectory()) {
    return result
  }

  result.exists = true

  let latestMtime = 0
  let latest: BackupStorageStats["latest"] = null

  async function walk(dir: string, depth: number) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    if (depth === 0) {
      result.topLevelEntries = entries.length
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          result.directoryCount += 1
          await walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const fileStat = await stat(fullPath)
          result.fileCount += 1
          result.totalBytes += fileStat.size
          if (fileStat.mtimeMs > latestMtime) {
            latestMtime = fileStat.mtimeMs
            latest = {
              name: entry.name,
              path: fullPath,
              size: formatBytes(fileStat.size),
              bytes: fileStat.size,
              mtime: fileStat.mtime.toISOString(),
            }
          }
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  await walk(rootPath, 0)
  result.totalSize = formatBytes(result.totalBytes)
  result.latest = latest
  return result
}

/** How long a storage walk is served as fresh before a background refresh. */
export const STORAGE_STATS_TTL_MS = 5 * 60 * 1000

type StorageStatsCache = {
  value: BackupStorageStats | null
  at: number
  /** A backup finished since the last walk started; next caller waits for a fresh walk. */
  dirty: boolean
  inflight: Promise<BackupStorageStats> | null
  watching: boolean
}

type GlobalWithStorageStats = typeof globalThis & {
  __lazybackupStorageStats?: StorageStatsCache
}

// Instrumentation and route handlers can load separate module copies; share via globalThis.
function storageStatsCache(): StorageStatsCache {
  const g = globalThis as GlobalWithStorageStats
  g.__lazybackupStorageStats ??= {
    value: null,
    at: 0,
    dirty: false,
    inflight: null,
    watching: false,
  }
  return g.__lazybackupStorageStats
}

function refreshStorageStats(cache: StorageStatsCache): Promise<BackupStorageStats> {
  if (!cache.inflight) {
    cache.dirty = false
    cache.inflight = getBackupStorageStats()
      .then((value) => {
        cache.value = value
        cache.at = Date.now()
        return value
      })
      .finally(() => {
        cache.inflight = null
      })
  }
  return cache.inflight
}

/**
 * Storage totals for the dashboard without re-walking BACKUP_STORAGE_PATH on
 * every request (tens of thousands of files take seconds warm, far longer with
 * a cold inode cache). Stale results are returned at once while a background
 * walk refreshes them; after a backup finishes the next caller waits for a
 * fresh walk. Concurrent callers share one walk.
 */
export async function getCachedBackupStorageStats(
  now = Date.now()
): Promise<BackupStorageStats> {
  const cache = storageStatsCache()
  if (!cache.value || cache.dirty) {
    return refreshStorageStats(cache)
  }
  if (now - cache.at >= STORAGE_STATS_TTL_MS) {
    void refreshStorageStats(cache).catch(() => {})
  }
  return cache.value
}

export function markBackupStorageStatsDirty(): void {
  storageStatsCache().dirty = true
}

/** Startup: walk once in the background and mark stale whenever a backup finishes. */
export function watchBackupStorageStats(): void {
  const cache = storageStatsCache()
  if (!cache.watching) {
    cache.watching = true
    subscribeBackupEvents((event) => {
      if (event.type === "backup.finished") markBackupStorageStatsDirty()
    })
  }
  void refreshStorageStats(cache).catch(() => {})
}

/** Tests only. */
export function clearBackupStorageStatsCache(): void {
  const cache = storageStatsCache()
  cache.value = null
  cache.at = 0
  cache.dirty = false
  cache.inflight = null
}

/**
 * Summarize what is currently stored at a backup config's destination path.
 * Remote destinations return a marker summary (no local filesystem walk).
 */
export async function getBackupDestinationSummary(options: {
  destinationPath: string
  destinationKind?: 'local' | 'server' | 's3' | 'peer' | null
  destinationServerName?: string | null
  destinationS3ProfileName?: string | null
  enableVersioning?: boolean | null
  versionsToKeep?: number | null
  entryLimit?: number
}): Promise<BackupDestinationSummary> {
  const configuredPath = options.destinationPath
  const enableVersioning = Boolean(options.enableVersioning)
  const versionsToKeep = options.versionsToKeep ?? null

  if ((options.destinationKind || 'local') === 'server') {
    return {
      configuredPath,
      path: configuredPath,
      exists: true,
      remote: true,
      remoteServerName: options.destinationServerName ?? null,
      totalBytes: 0,
      totalSize: formatBytes(0),
      fileCount: 0,
      directoryCount: 0,
      lastModified: null,
      truncated: false,
      versioning: {
        enabled: enableVersioning,
        versionsToKeep,
        versionCount: 0,
        versions: [],
      },
      topLevel: [],
    }
  }

  if ((options.destinationKind || 'local') === 's3') {
    return {
      configuredPath,
      path: configuredPath,
      exists: true,
      remote: true,
      remoteServerName: options.destinationS3ProfileName
        ? `S3: ${options.destinationS3ProfileName}`
        : 'S3',
      totalBytes: 0,
      totalSize: formatBytes(0),
      fileCount: 0,
      directoryCount: 0,
      lastModified: null,
      truncated: false,
      versioning: {
        enabled: enableVersioning,
        versionsToKeep,
        versionCount: 0,
        versions: [],
      },
      topLevel: [],
    }
  }

  if ((options.destinationKind || 'local') === 'peer') {
    return {
      configuredPath,
      path: configuredPath,
      exists: true,
      remote: true,
      remoteServerName: 'Bro peer',
      totalBytes: 0,
      totalSize: formatBytes(0),
      fileCount: 0,
      directoryCount: 0,
      lastModified: null,
      truncated: false,
      versioning: {
        enabled: enableVersioning,
        versionsToKeep,
        versionCount: 0,
        versions: [],
      },
      topLevel: [],
    }
  }

  const path = resolveLocalBackupPath(configuredPath)
  const entryLimit = options.entryLimit ?? DEFAULT_ENTRY_LIMIT

  const empty: BackupDestinationSummary = {
    configuredPath,
    path,
    exists: false,
    remote: false,
    totalBytes: 0,
    totalSize: formatBytes(0),
    fileCount: 0,
    directoryCount: 0,
    lastModified: null,
    truncated: false,
    versioning: {
      enabled: enableVersioning,
      versionsToKeep,
      versionCount: 0,
      versions: [],
    },
    topLevel: [],
  }

  let rootStat
  try {
    rootStat = await stat(path)
  } catch {
    return empty
  }

  if (!rootStat.isDirectory()) {
    return empty
  }

  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return empty
  }

  const topLevel: DestinationEntrySummary[] = []
  let totalBytes = 0
  let fileCount = 0
  let directoryCount = 0
  let lastModifiedMs = rootStat.mtimeMs

  for (const entry of entries) {
    const fullPath = join(path, entry.name)
    try {
      if (entry.isDirectory()) {
        const dirStat = await stat(fullPath)
        const nested = await walkTotals(fullPath)
        directoryCount += 1 + nested.directoryCount
        fileCount += nested.fileCount
        totalBytes += nested.bytes
        const entryMtimeMs = Math.max(dirStat.mtimeMs, nested.latestMtimeMs)
        if (entryMtimeMs > lastModifiedMs) {
          lastModifiedMs = entryMtimeMs
        }
        topLevel.push({
          name: entry.name,
          type: "directory",
          bytes: nested.bytes,
          size: formatBytes(nested.bytes),
          fileCount: nested.fileCount,
          directoryCount: nested.directoryCount,
          mtime: new Date(entryMtimeMs || dirStat.mtimeMs).toISOString(),
          isVersionDir: VERSION_DIR_PATTERN.test(entry.name),
        })
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath)
        fileCount += 1
        totalBytes += fileStat.size
        if (fileStat.mtimeMs > lastModifiedMs) {
          lastModifiedMs = fileStat.mtimeMs
        }
        topLevel.push({
          name: entry.name,
          type: "file",
          bytes: fileStat.size,
          size: formatBytes(fileStat.size),
          fileCount: 1,
          directoryCount: 0,
          mtime: fileStat.mtime.toISOString(),
          isVersionDir: false,
        })
      }
    } catch {
      // Skip unreadable entries
    }
  }

  topLevel.sort((a, b) => {
    if (a.mtime === b.mtime) {
      return b.name.localeCompare(a.name)
    }
    return b.mtime.localeCompare(a.mtime)
  })

  const truncated = topLevel.length > entryLimit
  const limitedTopLevel = topLevel.slice(0, entryLimit)
  const versions = topLevel
    .filter((entry) => entry.isVersionDir)
    .sort((a, b) => compareVersionDirNames(b.name, a.name))

  return {
    configuredPath,
    path,
    exists: true,
    totalBytes,
    totalSize: formatBytes(totalBytes),
    fileCount,
    directoryCount,
    lastModified: lastModifiedMs ? new Date(lastModifiedMs).toISOString() : null,
    truncated,
    versioning: {
      enabled: enableVersioning,
      versionsToKeep,
      versionCount: versions.length,
      versions: versions.slice(0, entryLimit),
    },
    topLevel: limitedTopLevel,
  }
}
