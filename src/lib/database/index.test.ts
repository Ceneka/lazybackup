import { describe, expect, test } from 'bun:test';
import { execFile, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { gunzipSync, gzipSync } from 'zlib';
import {
  archiveFileNameForDatabase,
  buildDatabaseTestCommand,
  buildDumpArgs,
  buildDumpToGzipWithStatus,
  buildMysqlDefinerStripCommand,
  buildPackDatabaseCommand,
  buildPackSqliteCommand,
  buildRestoreDatabaseCommand,
  buildRestoreSqliteCommand,
  buildSqliteVacuumIntoStatement,
  databaseArtifactEngine,
  defaultPortForEngine,
  MYSQL_DEFINER_STRIP_SED_EXPRESSIONS,
  packDatabaseDumpLocal,
  packSqliteSnapshotLocal,
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

  test('a failed dump stage fails the pipeline even though gzip succeeds', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-dump-status-'));
    try {
      const out = path.join(dir, 'out.sql.gz');
      await expect(
        execFileAsync('sh', ['-c', buildDumpToGzipWithStatus('exit 3', out)])
      ).rejects.toThrow();

      await execFileAsync('sh', [
        '-c',
        buildDumpToGzipWithStatus("printf 'dump-ok'", out),
      ]);
      expect(gunzipSync(await fs.readFile(out)).toString()).toBe('dump-ok');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
    expect(cmd).toContain("-h '127.0.0.1'");
    expect(cmd).toContain('gzip >');
    expect(cmd).toContain('$(cat');
    expect(cmd).not.toContain("s'ecret");
    // Password reaches docker via its environment, never its argv (`ps` visible).
    expect(cmd).toContain(`PGPASSWORD="$(cat '/tmp/pw')" docker exec`);
    expect(cmd).toContain('-e PGPASSWORD ');
    expect(cmd).not.toContain('-e PGPASSWORD=');
  });

  test('docker pack honors a custom host inside the container', () => {
    const cmd = buildPackDatabaseCommand(
      {
        ...basePostgres,
        client: 'docker',
        container: 'dump-tools',
        host: '10.8.0.12',
      },
      '/tmp/out/appdb.sql.gz'
    );
    expect(cmd).toContain('docker exec');
    expect(cmd).toContain("'dump-tools'");
    expect(cmd).toContain("-h '10.8.0.12'");
    expect(cmd).not.toContain("-h '127.0.0.1'");
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
    expect(cmd).toContain("-h 'db.internal'");
    expect(cmd).toContain('$(cat');
    expect(cmd).not.toContain('-e MYSQL_PWD=pw');
    expect(cmd).toContain(`MYSQL_PWD="$(cat '/tmp/pw')" docker exec -i`);
    expect(cmd).toContain('-e MYSQL_PWD ');
    expect(cmd).not.toContain('-e MYSQL_PWD=');
  });

  test('docker password stays out of docker exec argv in every command', () => {
    const conn: DatabaseConnection = {
      engine: 'postgres',
      client: 'docker',
      container: 'postgres_1',
      host: '127.0.0.1',
      port: 5432,
      user: 'app',
      password: 'P@ss with spaces',
      database: 'appdb',
    };
    const commands = [
      buildPackDatabaseCommand(conn, '/tmp/out/appdb.sql.gz', { passwordFile: '/tmp/pw' }),
      buildRestoreDatabaseCommand(conn, '/tmp/out/appdb.sql.gz', { passwordFile: '/tmp/pw' }),
      buildDatabaseTestCommand(conn, { passwordFile: '/tmp/pw' }),
    ];
    for (const cmd of commands) {
      expect(cmd).not.toContain('P@ss with spaces');
      expect(cmd).not.toContain(conn.password!);
      expect(cmd).toContain('-e PGPASSWORD ');
      expect(cmd).not.toContain('-e PGPASSWORD=');
    }
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

describe('postgres restore atomicity', () => {
  test('native/docker/remote restore command uses ON_ERROR_STOP and --single-transaction', () => {
    const native = buildRestoreDatabaseCommand(basePostgres, '/backups/appdb.sql.gz');
    expect(native).toContain('ON_ERROR_STOP=1');
    expect(native).toContain('--single-transaction');
    expect(native).toMatch(/gzip -t .* && gzip -dc .* \| psql /);

    const docker = buildRestoreDatabaseCommand(
      { ...basePostgres, client: 'docker', container: 'postgres_1' },
      '/tmp/appdb.sql.gz',
      { passwordFile: '/tmp/pw' }
    );
    expect(docker).toContain('--single-transaction');
    expect(docker).toContain('docker exec -i');
  });

  test('mysql/mariadb are not wrapped in --single-transaction (they strip DEFINERs instead)', () => {
    const cmd = buildRestoreDatabaseCommand(baseMysql, '/tmp/shop.sql.gz');
    expect(cmd).not.toContain('--single-transaction');
  });
});

describe('mysql/mariadb DEFINER stripping at restore time', () => {
  const dumpSample = [
    '/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg BEFORE INSERT ON t FOR EACH ROW SET NEW.v = 1 */;',
    'CREATE DEFINER=`root`@`localhost` PROCEDURE `p`()',
    'SELECT 1',
    '/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */',
    '/*!50001 VIEW `vw` AS select 1 */;',
    "INSERT INTO t VALUES ('DEFINER=`not`@`stripped`');",
  ].join('\n');

  test('restore command pipes gunzip through sed before the client', () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      const cmd = buildRestoreDatabaseCommand({ ...baseMysql, engine }, '/tmp/shop.sql.gz');
      expect(cmd).toContain('gzip -t');
      expect(cmd).toMatch(/gzip -dc .* \| sed .* \| (mysql|mariadb) /);
      expect(cmd).toContain('DEFINER=');
    }
  });

  test('sed expressions remove all dump DEFINER forms but keep data literals', () => {
    const out = execFileSync(
      'sed',
      MYSQL_DEFINER_STRIP_SED_EXPRESSIONS.flatMap((expression) => ['-e', expression]),
      { input: dumpSample, encoding: 'utf8' }
    );

    expect(out).not.toContain('DEFINER=`root`');
    expect(out).not.toContain('50017 DEFINER=');
    expect(out).not.toContain('50013 DEFINER=');
    expect(out).toContain('TRIGGER trg');
    expect(out).toContain('PROCEDURE `p`');
    expect(out).toContain('VIEW `vw`');
    // INSERT data that happens to look like a DEFINER must be left untouched.
    expect(out).toContain("INSERT INTO t VALUES ('DEFINER=`not`@`stripped`');");
  });

  test('definer strip command is shell-quotable', () => {
    const cmd = buildMysqlDefinerStripCommand();
    expect(cmd.startsWith('sed ')).toBe(true);
    expect(cmd.match(/-e /g)?.length).toBe(MYSQL_DEFINER_STRIP_SED_EXPRESSIONS.length);
  });
});

describe('sqlite snapshot without the sqlite3 CLI', () => {
  test('VACUUM INTO statement escapes single quotes', () => {
    expect(buildSqliteVacuumIntoStatement("/tmp/it's.db")).toBe(
      "VACUUM INTO '/tmp/it''s.db'"
    );
    expect(() => buildSqliteVacuumIntoStatement('  ')).toThrow();
  });

  test('bun:sqlite snapshot produces a readable gzip that includes WAL data', async () => {
    const { Database } = await import('bun:sqlite');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-sqlite-snap-'));
    const dbPath = path.join(dir, 'live.db');
    const archive = path.join(dir, 'snap.sqlite.gz');
    try {
      const db = new Database(dbPath, { create: true });
      db.run('PRAGMA journal_mode = WAL');
      db.run('CREATE TABLE t (x INTEGER)');
      db.run('INSERT INTO t VALUES (1), (2)');
      db.close();

      const result = await packSqliteSnapshotLocal(dbPath, archive);
      expect(result.code).toBe(0);

      const restored = path.join(dir, 'restored.db');
      await fs.writeFile(restored, gunzipSync(await fs.readFile(archive)));
      const check = new Database(restored, { readonly: true });
      const row = check.query('SELECT SUM(x) AS s FROM t').get() as { s: number };
      check.close();
      expect(row.s).toBe(3);

      const mode = (await fs.stat(archive)).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('packDatabaseDumpLocal restores a consistent sqlite archive', async () => {
    const { Database } = await import('bun:sqlite');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-sqlite-pack-'));
    const dbPath = path.join(dir, 'live.db');
    try {
      const db = new Database(dbPath, { create: true });
      db.run('CREATE TABLE t (x INTEGER)');
      db.run('INSERT INTO t VALUES (7)');
      db.close();

      const packed = await packDatabaseDumpLocal({
        engine: 'sqlite',
        client: 'native',
        user: 'sqlite',
        database: dbPath,
      });
      const restored = path.join(dir, 'restored.db');
      await fs.writeFile(restored, gunzipSync(await fs.readFile(packed.archivePath)));
      const check = new Database(restored, { readonly: true });
      const row = check.query('SELECT x FROM t').get() as { x: number };
      check.close();
      expect(row.x).toBe(7);
      await fs.rm(packed.tmpDir, { recursive: true, force: true });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

const baseSqlite: DatabaseConnection = {
  engine: 'sqlite',
  client: 'native',
  user: 'sqlite',
  database: '/var/lib/app/data.db',
};

describe('databaseArtifactEngine', () => {
  test('recognizes SQL and SQLite dump names, including age and S3 paths', () => {
    expect(databaseArtifactEngine('/backups/app/app.sql.gz')).toBe('server');
    expect(databaseArtifactEngine('/backups/app/app.sql.gz.age')).toBe('server');
    expect(databaseArtifactEngine('s3://bucket/base/app.sql.gz.age')).toBe('server');
    expect(databaseArtifactEngine('/backups/app/data.sqlite.gz')).toBe('sqlite');
    expect(databaseArtifactEngine('/backups/app/data.sqlite.gz.age')).toBe('sqlite');
    expect(databaseArtifactEngine('/backups/app/vol.tar.gz')).toBeNull();
  });
});

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

  test('restore removes WAL/journal sidecars from the replaced database', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-sqlite-restore-'));
    try {
      const db = path.join(dir, 'app.db');
      const archive = path.join(dir, 'app.sqlite.gz');
      await fs.writeFile(db, 'old database');
      await fs.writeFile(`${db}-wal`, 'stale wal');
      await fs.writeFile(`${db}-shm`, 'stale shm');
      await fs.writeFile(`${db}-journal`, 'stale journal');
      await fs.writeFile(archive, gzipSync(Buffer.from('new database')));

      await execFileAsync('sh', ['-c', buildRestoreSqliteCommand(db, archive)]);

      expect(await fs.readFile(db, 'utf8')).toBe('new database');
      for (const suffix of ['-wal', '-shm', '-journal']) {
        expect(await fs.stat(`${db}${suffix}`).catch(() => null)).toBeNull();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
