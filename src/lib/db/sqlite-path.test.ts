import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  resolveSqliteFilePath,
  restrictSqliteFilePermissions,
} from './sqlite-path'

describe('resolveSqliteFilePath', () => {
  test('parses file: relative URL', () => {
    const resolved = resolveSqliteFilePath('file:./data.db')
    expect(resolved).toBe(path.resolve('./data.db'))
  })

  test('parses file:/// absolute URL', () => {
    expect(resolveSqliteFilePath('file:///tmp/lb.db')).toBe('/tmp/lb.db')
  })

  test('parses bare path', () => {
    expect(resolveSqliteFilePath('/var/lib/lazybackup/data.db')).toBe(
      '/var/lib/lazybackup/data.db'
    )
  })
})

describe('restrictSqliteFilePermissions', () => {
  test('chmods the DB and WAL companions to 0600', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-perm-'))
    const dbPath = path.join(dir, 'data.db')
    try {
      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        await fs.writeFile(file, '', { mode: 0o644 })
        await fs.chmod(file, 0o644)
      }

      await restrictSqliteFilePermissions(`file:${dbPath}`)

      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test('ignores remote libsql URLs', async () => {
    await expect(
      restrictSqliteFilePermissions('libsql://example.turso.io')
    ).resolves.toBeUndefined()
  })
})
