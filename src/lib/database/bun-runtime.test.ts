import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';
import {
  BUN_RUNTIME_UNAVAILABLE_MESSAGE,
  BunRuntimeUnavailableError,
  formatSqliteFallbackWarning,
  packDatabaseDumpLocal,
  resetBunBinaryCacheForTests,
  resolveBunBinary,
  snapshotSqliteLocal,
} from './index';
import {
  copySqliteWithWalSidecars,
  packLazybackupInstance,
  snapshotInstanceDatabase,
} from '@/lib/backup/instance-export';

const ORIGINAL_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  BUN_BINARY: process.env.BUN_BINARY,
  DATABASE_URL: process.env.DATABASE_URL,
};
// Configurable in Bun, so a test can present itself as `next start` on Node.
const ORIGINAL_BUN_VERSION = process.versions.bun;

function restoreEnv(): void {
  for (const key of ['PATH', 'HOME', 'BUN_BINARY', 'DATABASE_URL'] as const) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (ORIGINAL_BUN_VERSION === undefined) delete process.versions.bun;
  else process.versions.bun = ORIGINAL_BUN_VERSION;
  resetBunBinaryCacheForTests();
}

afterEach(() => {
  restoreEnv();
});

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-bun-runtime-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function makeExecutable(filePath: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
  return filePath;
}

/** Present the process as the Node runtime `next start` uses, with a sandboxed PATH/HOME. */
async function simulateNodeRuntime(dir: string): Promise<{ bin: string; home: string }> {
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  delete process.versions.bun;
  delete process.env.BUN_BINARY;
  process.env.PATH = bin;
  process.env.HOME = home;
  resetBunBinaryCacheForTests();
  return { bin, home };
}

describe('resolveBunBinary', () => {
  test('uses the running Bun executable under Bun', async () => {
    expect(process.versions.bun).toBeTruthy();
    expect(await resolveBunBinary()).toBe(process.execPath);
  });

  test('prefers an executable BUN_BINARY on a Node runtime', async () => {
    await withTmpDir(async (dir) => {
      const fakeBun = await makeExecutable(path.join(dir, 'custom-bun'));
      await simulateNodeRuntime(dir);
      process.env.BUN_BINARY = fakeBun;
      expect(await resolveBunBinary()).toBe(fakeBun);
    });
  });

  test('ignores BUN_BINARY when it is not executable', async () => {
    await withTmpDir(async (dir) => {
      const fakeBun = path.join(dir, 'custom-bun');
      await fs.writeFile(fakeBun, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
      await simulateNodeRuntime(dir);
      process.env.BUN_BINARY = fakeBun;
      expect(await resolveBunBinary()).toBeNull();
    });
  });

  test('finds bun on PATH without a shell', async () => {
    await withTmpDir(async (dir) => {
      const sandbox = await simulateNodeRuntime(dir);
      const bunPath = await makeExecutable(path.join(sandbox.bin, 'bun'));
      expect(await resolveBunBinary()).toBe(bunPath);
    });
  });

  test('falls back to ~/.bun/bin/bun', async () => {
    await withTmpDir(async (dir) => {
      const sandbox = await simulateNodeRuntime(dir);
      const installed = await makeExecutable(path.join(sandbox.home, '.bun', 'bin', 'bun'));
      expect(await resolveBunBinary()).toBe(installed);
    });
  });

  test('returns null when PATH and the default install have no bun', async () => {
    await withTmpDir(async (dir) => {
      await simulateNodeRuntime(dir);
      expect(await resolveBunBinary()).toBeNull();
    });
  });

  test('caches the resolution until the test hook resets it', async () => {
    await withTmpDir(async (dir) => {
      const first = await makeExecutable(path.join(dir, 'bun-one'));
      const second = await makeExecutable(path.join(dir, 'bun-two'));
      await simulateNodeRuntime(dir);
      process.env.BUN_BINARY = first;
      expect(await resolveBunBinary()).toBe(first);

      process.env.BUN_BINARY = second;
      expect(await resolveBunBinary()).toBe(first);

      resetBunBinaryCacheForTests();
      expect(await resolveBunBinary()).toBe(second);
    });
  });
});

describe('snapshotSqliteLocal without Bun', () => {
  test('throws the short typed error, never a Node stack', async () => {
    await withTmpDir(async (dir) => {
      await simulateNodeRuntime(dir);
      const dbPath = path.join(dir, 'data.db');
      await fs.writeFile(dbPath, '');

      const error = await snapshotSqliteLocal(dbPath, path.join(dir, 'snapshot.db')).catch(
        (caught) => caught
      );
      expect(error).toBeInstanceOf(BunRuntimeUnavailableError);
      expect(error.message).toBe(
        'A consistent SQLite snapshot needs the Bun runtime (bun not found on PATH)'
      );
      expect(error.message).toBe(BUN_RUNTIME_UNAVAILABLE_MESSAGE);
      expect(error.message).not.toContain('\n');
    });
  });

  test('spawns the resolved bun binary on a Node runtime', async () => {
    await withTmpDir(async (dir) => {
      const marker = path.join(dir, 'bun-ran');
      const fakeBun = path.join(dir, 'fake-bun');
      await fs.writeFile(fakeBun, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(marker)}\n`, {
        mode: 0o755,
      });
      await fs.chmod(fakeBun, 0o755);
      const dbPath = path.join(dir, 'data.db');
      await fs.writeFile(dbPath, '');

      await simulateNodeRuntime(dir);
      process.env.BUN_BINARY = fakeBun;

      const result = await snapshotSqliteLocal(dbPath, path.join(dir, 'snapshot.db'));
      expect(result.code).toBe(0);
      expect(await fs.readFile(marker, 'utf8')).toContain('-e');
    });
  });
});

describe('instance snapshot fallback', () => {
  test('wal-copy keeps commits that only exist in the live WAL', async () => {
    const { Database } = await import('bun:sqlite');
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'data.db');
      const copyPath = path.join(dir, 'bundle', 'data.db');
      await fs.mkdir(path.dirname(copyPath), { recursive: true });

      const db = new Database(dbPath, { create: true });
      try {
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA wal_autocheckpoint = 0');
        db.run('CREATE TABLE t (x INTEGER)');
        db.run('INSERT INTO t VALUES (4), (5)');
        // Keep the writer open: these rows exist only in -wal right now, so a
        // main-file-only copy would silently lose them.
        await simulateNodeRuntime(dir);
        const fallback = await snapshotInstanceDatabase(dbPath, copyPath);
        expect(fallback).toBe('wal-copy');

        const wal = await fs.stat(`${copyPath}-wal`).catch(() => null);
        expect(wal?.size ?? 0).toBeGreaterThan(0);

        const check = new Database(copyPath, { readonly: true });
        const row = check.query('SELECT SUM(x) AS s FROM t').get() as { s: number };
        check.close();
        expect(row.s).toBe(9);
      } finally {
        db.close();
      }
    });
  });

  test('copy helper works without a WAL sidecar', async () => {
    const { Database } = await import('bun:sqlite');
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'plain.db');
      const copyPath = path.join(dir, 'copy.db');
      const db = new Database(dbPath, { create: true });
      db.run('CREATE TABLE t (x INTEGER)');
      db.run('INSERT INTO t VALUES (1)');
      db.close();

      await copySqliteWithWalSidecars(dbPath, copyPath);
      const check = new Database(copyPath, { readonly: true });
      const row = check.query('SELECT x FROM t').get() as { x: number };
      check.close();
      expect(row.x).toBe(1);
    });
  });

  test('a working Bun snapshot reports no fallback', async () => {
    const { Database } = await import('bun:sqlite');
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'data.db');
      const snapshotPath = path.join(dir, 'snapshot.db');
      const db = new Database(dbPath, { create: true });
      db.run('CREATE TABLE t (x INTEGER)');
      db.run('INSERT INTO t VALUES (3)');
      db.close();

      expect(await snapshotInstanceDatabase(dbPath, snapshotPath)).toBeNull();
      expect(await fs.stat(`${snapshotPath}-wal`).catch(() => null)).toBeNull();
    });
  });

  test('Node runtime with bun on PATH still gets a consistent snapshot', async () => {
    const { Database } = await import('bun:sqlite');
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'data.db');
      const snapshotPath = path.join(dir, 'snapshot.db');
      const db = new Database(dbPath, { create: true });
      try {
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA wal_autocheckpoint = 0');
        db.run('CREATE TABLE t (x INTEGER)');
        db.run('INSERT INTO t VALUES (11)');
        // No Bun runtime flag, only a bun binary on PATH: exactly what
        // `next start` sees on a host with Bun installed. The writer stays
        // open, so only VACUUM INTO returns the committed row.
        const sandbox = await simulateNodeRuntime(dir);
        await fs.symlink(process.execPath, path.join(sandbox.bin, 'bun'));

        expect(await snapshotInstanceDatabase(dbPath, snapshotPath)).toBeNull();
        const check = new Database(snapshotPath, { readonly: true });
        const row = check.query('SELECT SUM(x) AS s FROM t').get() as { s: number };
        check.close();
        expect(row.s).toBe(11);
      } finally {
        db.close();
      }
    });
  });

  test('packLazybackupInstance still fails for non-runtime errors', async () => {
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'garbage.db');
      await fs.writeFile(dbPath, 'this is not a sqlite database');
      process.env.DATABASE_URL = `file:${dbPath}`;

      const error = await packLazybackupInstance().catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(BunRuntimeUnavailableError);
      expect(error.message).toMatch(/not a database|SQLITE_NOTADB/i);
    });
  });
});

function resolveTool(tool: string): string {
  const result = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  const found = (result.stdout ?? '').trim();
  if (!found) throw new Error(`test dependency not found: ${tool}`);
  return found;
}

/** PATH with only the shell tools the sqlite cp fallback needs (no bun, no sqlite3). */
async function shellToolsOnly(dir: string): Promise<string> {
  const bin = path.join(dir, 'shell-bin');
  await fs.mkdir(bin, { recursive: true });
  for (const tool of ['cp', 'gzip', 'mktemp', 'rm']) {
    await fs.symlink(resolveTool(tool), path.join(bin, tool));
  }
  return bin;
}

describe('sqlite dump cp-fallback warning', () => {
  test('names the reason in one line when Bun is missing', async () => {
    const { Database } = await import('bun:sqlite');
    await withTmpDir(async (dir) => {
      const dbPath = path.join(dir, 'data.db');
      const db = new Database(dbPath, { create: true });
      db.run('CREATE TABLE t (x INTEGER)');
      db.run('INSERT INTO t VALUES (7)');
      db.close();

      const bin = await shellToolsOnly(dir);
      await simulateNodeRuntime(dir);
      process.env.PATH = bin;

      const packed = await packDatabaseDumpLocal({
        engine: 'sqlite',
        client: 'native',
        user: 'sqlite',
        database: dbPath,
      });
      try {
        const [firstLine] = packed.stderr.split('\n');
        expect(firstLine).toBe(
          `SQLite consistent snapshot unavailable (${BUN_RUNTIME_UNAVAILABLE_MESSAGE}); using cp fallback`
        );
        expect(packed.stderr).not.toContain('    at ');
        const restored = path.join(dir, 'restored.db');
        await fs.writeFile(restored, gunzipSync(await fs.readFile(packed.archivePath)));
        const check = new Database(restored, { readonly: true });
        const row = check.query('SELECT x FROM t').get() as { x: number };
        check.close();
        expect(row.x).toBe(7);
      } finally {
        await fs.rm(packed.tmpDir, { recursive: true, force: true });
      }
    });
  });

  test('keeps a spawned runtime failure to one line, not a stack trace', () => {
    // Deterministic: exercising the full dump path depends on whether the host
    // has sqlite3 (the Alpine image does), which changes the fallback command.
    const stacky = new Error(
      [
        'SQLiteError: file is not a database',
        '    at Database.prepare (bun:sqlite:1:1)',
        '    at async run (/app/src/lib/database/index.ts:1:1)',
        'Bun v1.4.4',
      ].join('\n')
    );

    const warning = formatSqliteFallbackWarning(stacky);
    expect(warning).toBe(
      'SQLite consistent snapshot unavailable (SQLiteError: file is not a database); using cp fallback'
    );
    expect(warning).not.toContain('\n');
    expect(warning).not.toContain('    at ');
    expect(warning).not.toContain('Bun v');
    expect(warning.length).toBeLessThan(240);

    const noMessage = Object.assign(new Error(''), { code: 'ENOENT' });
    expect(formatSqliteFallbackWarning(noMessage)).toContain('ENOENT');
  });
});
