import { formatBytes } from "@/lib/utils"
import { readdir, stat } from "fs/promises"
import { join } from "path"

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
