import { chmod } from 'fs/promises'
import path from 'path'

/** Resolve the SQLite file path from DATABASE_URL (file:… or absolute). */
export function resolveSqliteFilePath(
  databaseUrl = process.env.DATABASE_URL || 'file:./data.db'
): string {
  const raw = databaseUrl.trim()
  if (raw.startsWith('file:')) {
    const without = raw.slice('file:'.length)
    // file:/absolute or file:./relative
    if (without.startsWith('///')) {
      return without.slice(2) // file:///path → /path
    }
    if (without.startsWith('//')) {
      // file://host/path — uncommon for sqlite; treat as path after host
      const idx = without.indexOf('/', 2)
      return idx >= 0 ? without.slice(idx) : without
    }
    return path.resolve(without)
  }
  return path.resolve(raw)
}

/**
 * The SQLite file stores every secret LazyBackup knows (SSH passwords/keys,
 * S3 keys, DB passwords, peer tokens). Restrict it (and its WAL companions) to
 * the owner: the default 0644 is readable by every local user on a shared host.
 * Best-effort: libsql may not have created the files yet / may not own them.
 */
export async function restrictSqliteFilePermissions(
  databaseUrl?: string
): Promise<void> {
  const url = (databaseUrl ?? process.env.DATABASE_URL ?? 'file:./data.db').trim()
  // Only local SQLite files; leave remote libsql/http URLs alone.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return

  const filePath = resolveSqliteFilePath(url)
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try {
      await chmod(candidate, 0o600)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') continue
      console.warn(`Could not restrict permissions on ${candidate}:`, error)
    }
  }
}
