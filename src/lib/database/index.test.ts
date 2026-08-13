import { describe, expect, test } from 'bun:test';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {
  archiveFileNameForDatabase,
  buildDatabaseTestCommand,
  buildDumpArgs,
  buildPackDatabaseCommand,
  buildPackSqliteCommand,
  buildRestoreDatabaseCommand,
  buildRestoreSqliteCommand,
  defaultPortForEngine,
  packDatabaseDumpLocal,
  restoreDatabaseLocal,
  type DatabaseConnection,
} from './index';

const basePostgres: DatabaseConnection = {
  engine: 'postgres',
  client: 'native',
  host: '127.0.0.1',
  port: 5432,
  user: 'app',
  password: "s'ecret",
  database: 'appdb',
};

const baseMysql: DatabaseConnection = {
  engine: 'mysql',
  client: 'native',
  host: 'db.internal',
  user: 'root',
  password: 'pw',
  database: 'shop',
};

describe('database command builders', () => {
  test('default ports', () => {
    expect(defaultPortForEngine('postgres')).toBe(5432);
    expect(defaultPortForEngine('mysql')).toBe(3306);
    expect(defaultPortForEngine('mariadb')).toBe(3306);
  });

  test('archive file name', () => {
    expect(archiveFileNameForDatabase('appdb')).toBe('appdb.sql.gz');
    expect(archiveFileNameForDatabase('/var/lib/app/data.db', 'sqlite')).toBe(
      'data.sqlite.gz'
    );
  });

  test('native postgres dump args include quoting and flags', () => {
    const args = buildDumpArgs(basePostgres);
    expect(args).toContain('pg_dump');
    expect(args).toContain("-d 'appdb'");
    expect(args).toContain('--no-owner --no-acl');
  });

  test('native mysql dump uses mysqldump and single-transaction', () => {
    const args = buildDumpArgs(baseMysql);
    expect(args).toContain('mysqldump');
    expect(args).toContain('--single-transaction');
    expect(args).toContain("'shop'");
  });

  test('mariadb uses mariadb-dump binary', () => {
    const args = buildDumpArgs({ ...baseMysql, engine: 'mariadb' });
    expect(args).toContain('mariadb-dump');
  });

  test('pack command redirects gzip to file and does not embed the password', () => {
    const cmd = buildPackDatabaseCommand(basePostgres, '/tmp/lazybackup-db-x/appdb.sql.gz', {
      passwordFile: '/tmp/pw',
    });
    expect(cmd).toContain('gzip >');
    expect(cmd).toContain('/tmp/lazybackup-db-x/appdb.sql.gz');
    expect(cmd).toContain("PGPASSFILE='/tmp/pw'");
    expect(cmd).toContain('pg_dump');
    expect(cmd).not.toContain('PGPASSWORD=');
    expect(cmd).not.toContain("s'ecret");
  });

  test('docker pack uses docker exec and host gzip redirect', () => {
    const cmd = buildPackDatabaseCommand(
      {
        ...basePostgres,
        client: 'docker',
        container: 'postgres_1',
      },
      '/tmp/out/appdb.sql.gz',
      { passwordFile: '/tmp/pw' }
    );
    expect(cmd).toContain('docker exec');
    expect(cmd).toContain("'postgres_1'");
    expect(cmd).toContain('gzip >');
    expect(cmd).toContain('$(cat');
    expect(cmd).not.toContain("s'ecret");
  });

  test('restore pipes gunzip into client', () => {
    const cmd = buildRestoreDatabaseCommand(basePostgres, '/backups/appdb.sql.gz');
    expect(cmd).toContain('gzip -dc');
    expect(cmd).toContain('psql');
    expect(cmd).toContain('ON_ERROR_STOP');
  });

  test('docker restore uses docker exec -i', () => {
    const cmd = buildRestoreDatabaseCommand(
      {
        ...baseMysql,
        client: 'docker',
        container: 'mysql',
      },
      '/tmp/shop.sql.gz',
      { passwordFile: '/tmp/pw' }
    );
    expect(cmd).toContain('docker exec -i');
    expect(cmd).toContain('mysql');
    expect(cmd).toContain('$(cat');
    expect(cmd).not.toContain('-e MYSQL_PWD=pw');
  });

  test('test command runs SELECT 1', () => {
    const cmd = buildDatabaseTestCommand(basePostgres);
    expect(cmd).toContain('SELECT 1');
    expect(cmd).toContain('psql');
  });

  test('rejects invalid database names in pack', () => {
    expect(() =>
      buildPackDatabaseCommand({ ...basePostgres, database: '../evil' }, '/tmp/x.sql.gz')
    ).toThrow();
  });
});

const baseSqlite: DatabaseConnection = {
  engine: 'sqlite',
  client: 'native',
  user: 'sqlite',
  database: '/var/lib/app/data.db',
};

describe('sqlite dump engine', () => {
  test('pack uses sqlite3 .backup or cp then gzip', () => {
    const cmd = buildPackSqliteCommand('/var/lib/app/data.db', '/tmp/out/data.sqlite.gz');
    expect(cmd).toContain('sqlite3');
    expect(cmd).toContain('.backup');
    expect(cmd).toContain('gzip -c');
    expect(cmd).toContain('/var/lib/app/data.db');
    expect(cmd).toContain('/tmp/out/data.sqlite.gz');
    expect(buildPackDatabaseCommand(baseSqlite, '/tmp/out/data.sqlite.gz')).toContain(
      'sqlite3'
    );
  });

  test('restore gunzips onto the file path', () => {
    const cmd = buildRestoreSqliteCommand('/var/lib/app/data.db', '/tmp/data.sqlite.gz');
    expect(cmd).toContain('gzip -dc');
    expect(cmd).toContain('/var/lib/app/data.db');
    expect(buildRestoreDatabaseCommand(baseSqlite, '/tmp/data.sqlite.gz')).toContain(
      'gzip -dc'
    );
  });

  test('test checks the file and optional sqlite3 SELECT 1', () => {
    const cmd = buildDatabaseTestCommand(baseSqlite);
    expect(cmd).toContain('test -r');
    expect(cmd).toContain('SELECT 1');
  });

  test('rejects path traversal', () => {
    expect(() => buildPackSqliteCommand('../evil.db', '/tmp/x.sqlite.gz')).toThrow(/\.\./);
  });
});

const execFileAsync = promisify(execFile);

async function sqlite3Available(): Promise<boolean> {
  try {
    await execFileAsync('sqlite3', ['-version']);
    return true;
  } catch {
    return false;
  }
}

const hasSqlite3 = await sqlite3Available();

describe.skipIf(!hasSqlite3)('sqlite live dump', () => {
  test('packs and restores a file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-sqlite-'));
    const dbPath = path.join(dir, 'app.db');
    const restored = path.join(dir, 'restored.db');
    await execFileAsync('sqlite3', [dbPath, 'CREATE TABLE t(x); INSERT INTO t VALUES (1);']);
    try {
      const packed = await packDatabaseDumpLocal({
        engine: 'sqlite',
        client: 'native',
        user: 'sqlite',
        database: dbPath,
      });
      expect(packed.archivePath.endsWith('.sqlite.gz')).toBe(true);
      await restoreDatabaseLocal(
        { engine: 'sqlite', client: 'native', user: 'sqlite', database: restored },
        packed.archivePath
      );
      const { stdout } = await execFileAsync('sqlite3', [restored, 'SELECT x FROM t;']);
      expect(stdout.trim()).toBe('1');
      await fs.rm(packed.tmpDir, { recursive: true, force: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
