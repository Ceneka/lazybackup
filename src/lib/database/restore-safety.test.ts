import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import {
  buildRestoreDatabaseCommand,
  buildRestoreSqliteCommand,
  restoreDatabaseLocal,
  type DatabaseConnection,
} from './index';

function sqliteConn(dbPath: string): DatabaseConnection {
  return {
    engine: 'sqlite',
    client: 'native',
    user: 'sqlite',
    database: dbPath,
  };
}

function postgresConn(): DatabaseConnection {
  return {
    engine: 'postgres',
    client: 'native',
    host: '127.0.0.1',
    port: 5432,
    user: 'app',
    password: 'secret',
    database: 'app',
  };
}

/** A gzip stream that is cut off mid-deflate: decompression starts, then fails. */
async function writeTruncatedGzip(file: string): Promise<void> {
  const full = gzipSync(Buffer.from('SELECT 1;\n'.repeat(2_000)));
  await fs.writeFile(file, full.subarray(0, Math.floor(full.length * 0.6)));
}

describe('sqlite restore is not atomic today', () => {
  test('a corrupt archive must not truncate the live database', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-sqlite-restore-'));
    const liveDb = path.join(dir, 'app.db');
    const corrupt = path.join(dir, 'app.sqlite.gz');
    const precious = 'PRECIOUS-LIVE-DATA';
    try {
      await fs.writeFile(liveDb, precious);
      await writeTruncatedGzip(corrupt);

      await expect(restoreDatabaseLocal(sqliteConn(liveDb), corrupt)).rejects.toThrow();

      // The failed restore must leave the original database untouched.
      const after = await fs.readFile(liveDb, 'utf8');
      expect(after).toBe(precious);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('sqlite restore writes via a temp file and renames', () => {
    const cmd = buildRestoreSqliteCommand('/var/lib/app/data.db', '/tmp/data.sqlite.gz');
    expect(cmd).toContain('mktemp');
    expect(cmd).toMatch(/mv /);
  });
});

describe('non-sqlite restores verify the archive before touching the database', () => {
  test('postgres restore command checks gzip integrity first', () => {
    const cmd = buildRestoreDatabaseCommand(postgresConn(), '/tmp/app.sql.gz');
    expect(cmd).toMatch(/gzip -t/);
  });

  test('mysql restore command checks gzip integrity first', () => {
    const cmd = buildRestoreDatabaseCommand(
      { ...postgresConn(), engine: 'mysql', client: 'native', password: null },
      '/tmp/app.sql.gz'
    );
    expect(cmd).toMatch(/gzip -t/);
  });

  test('docker-client restore command checks gzip integrity first', () => {
    const cmd = buildRestoreDatabaseCommand(
      { ...postgresConn(), client: 'docker', container: 'db' },
      '/tmp/app.sql.gz'
    );
    expect(cmd).toMatch(/gzip -t/);
  });
});
