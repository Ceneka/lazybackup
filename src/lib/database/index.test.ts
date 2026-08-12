import { describe, expect, test } from 'bun:test';
import {
  archiveFileNameForDatabase,
  buildDatabaseTestCommand,
  buildDumpArgs,
  buildPackDatabaseCommand,
  buildRestoreDatabaseCommand,
  defaultPortForEngine,
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
