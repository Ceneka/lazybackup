import { shellSingleQuote } from '@/lib/ssh/rsync';
import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { NodeSSH } from 'node-ssh';

const execAsync = promisify(exec);

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

export type DbEngine = 'postgres' | 'mysql' | 'mariadb';
export type DbClient = 'native' | 'docker';

export type DatabaseConnection = {
  engine: DbEngine;
  client: DbClient;
  container?: string | null;
  host?: string | null;
  port?: number | null;
  user: string;
  password?: string | null;
  database: string;
};

export const DB_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_$-]*$/;

export function defaultPortForEngine(engine: DbEngine): number {
  return engine === 'postgres' ? 5432 : 3306;
}

export function resolveDbPort(conn: DatabaseConnection): number {
  return conn.port && conn.port > 0 ? conn.port : defaultPortForEngine(conn.engine);
}

export function assertValidDatabaseName(name: string): void {
  if (!DB_NAME_RE.test(name)) {
    throw new Error(`Invalid database name: ${name}. Names must match ${DB_NAME_RE}`);
  }
}

export function assertValidContainerName(name: string): void {
  if (!DOCKER_VOLUME_NAME_RE.test(name)) {
    throw new Error(`Invalid Docker container name: ${name}`);
  }
}

function passwordEnvAssignment(engine: DbEngine, password: string): string {
  const envName = engine === 'postgres' ? 'PGPASSWORD' : 'MYSQL_PWD';
  return `${envName}=${shellSingleQuote(password)}`;
}

function dockerPasswordFlag(engine: DbEngine, password: string): string {
  const envName = engine === 'postgres' ? 'PGPASSWORD' : 'MYSQL_PWD';
  return `-e ${envName}=${shellSingleQuote(password)}`;
}

function dumpBinary(engine: DbEngine): string {
  if (engine === 'postgres') return 'pg_dump';
  if (engine === 'mariadb') return 'mariadb-dump';
  return 'mysqldump';
}

function clientBinary(engine: DbEngine): string {
  if (engine === 'postgres') return 'psql';
  if (engine === 'mariadb') return 'mariadb';
  return 'mysql';
}

function effectiveHost(conn: DatabaseConnection): string {
  if (conn.client === 'docker') return '127.0.0.1';
  return (conn.host || '127.0.0.1').trim() || '127.0.0.1';
}

/** pg_dump / mysqldump argv (no env, no gzip). */
export function buildDumpArgs(conn: DatabaseConnection): string {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  const user = conn.user;
  const db = conn.database;

  if (conn.engine === 'postgres') {
    return [
      dumpBinary(conn.engine),
      `-h ${shellSingleQuote(host)}`,
      `-p ${port}`,
      `-U ${shellSingleQuote(user)}`,
      `-d ${shellSingleQuote(db)}`,
      '--no-owner --no-acl',
    ].join(' ');
  }

  return [
    dumpBinary(conn.engine),
    `-h ${shellSingleQuote(host)}`,
    `-P ${port}`,
    `-u ${shellSingleQuote(user)}`,
    '--single-transaction --routines --triggers',
    shellSingleQuote(db),
  ].join(' ');
}

/** psql / mysql client that reads SQL from stdin. */
export function buildRestoreClientArgs(conn: DatabaseConnection): string {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  const user = conn.user;
  const db = conn.database;

  if (conn.engine === 'postgres') {
    return [
      clientBinary(conn.engine),
      `-h ${shellSingleQuote(host)}`,
      `-p ${port}`,
      `-U ${shellSingleQuote(user)}`,
      `-d ${shellSingleQuote(db)}`,
      '-v ON_ERROR_STOP=1',
    ].join(' ');
  }

  return [
    clientBinary(conn.engine),
    `-h ${shellSingleQuote(host)}`,
    `-P ${port}`,
    `-u ${shellSingleQuote(user)}`,
    shellSingleQuote(db),
  ].join(' ');
}

/** SELECT 1 probe via client CLI. */
export function buildTestClientArgs(conn: DatabaseConnection): string {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  const user = conn.user;
  const db = conn.database;

  if (conn.engine === 'postgres') {
    return [
      clientBinary(conn.engine),
      `-h ${shellSingleQuote(host)}`,
      `-p ${port}`,
      `-U ${shellSingleQuote(user)}`,
      `-d ${shellSingleQuote(db)}`,
      '-tAc',
      shellSingleQuote('SELECT 1'),
    ].join(' ');
  }

  return [
    clientBinary(conn.engine),
    `-h ${shellSingleQuote(host)}`,
    `-P ${port}`,
    `-u ${shellSingleQuote(user)}`,
    `-N -e`,
    shellSingleQuote('SELECT 1'),
    shellSingleQuote(db),
  ].join(' ');
}

function requireContainer(conn: DatabaseConnection): string {
  const container = conn.container?.trim();
  if (!container) {
    throw new Error('Container name is required for docker client mode');
  }
  assertValidContainerName(container);
  return container;
}

/**
 * Host-side command that dumps to archiveFilePath (.sql.gz).
 * Dump bytes go to the file via shell redirection — not through Node stdout.
 * One shell-quoting level only (caller may invoke via SSH or child_process shell).
 */
export function buildPackDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string
): string {
  assertValidDatabaseName(conn.database);
  const quotedOut = shellSingleQuote(archiveFilePath);
  const password = conn.password ?? '';
  const dumpArgs = buildDumpArgs(conn);

  let dumpPart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    dumpPart = `docker exec ${dockerPasswordFlag(conn.engine, password)} ${shellSingleQuote(container)} ${dumpArgs}`;
  } else {
    dumpPart = `${passwordEnvAssignment(conn.engine, password)} ${dumpArgs}`;
  }

  return `${REMOTE_STANDARD_PATH} ${dumpPart} | gzip > ${quotedOut}`;
}

export function buildRestoreDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string
): string {
  assertValidDatabaseName(conn.database);
  const quotedIn = shellSingleQuote(archiveFilePath);
  const password = conn.password ?? '';
  const clientArgs = buildRestoreClientArgs(conn);

  let restorePart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    restorePart = `docker exec -i ${dockerPasswordFlag(conn.engine, password)} ${shellSingleQuote(container)} ${clientArgs}`;
  } else {
    restorePart = `${passwordEnvAssignment(conn.engine, password)} ${clientArgs}`;
  }

  return `${REMOTE_STANDARD_PATH} gzip -dc ${quotedIn} | ${restorePart}`;
}

export function buildDatabaseTestCommand(conn: DatabaseConnection): string {
  assertValidDatabaseName(conn.database);
  const password = conn.password ?? '';
  const testArgs = buildTestClientArgs(conn);

  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    return [
      REMOTE_STANDARD_PATH,
      'docker exec',
      dockerPasswordFlag(conn.engine, password),
      shellSingleQuote(container),
      testArgs,
    ].join(' ');
  }

  return `${REMOTE_STANDARD_PATH} ${passwordEnvAssignment(conn.engine, password)} ${testArgs}`;
}

export function archiveFileNameForDatabase(database: string): string {
  assertValidDatabaseName(database);
  return `${database}.sql.gz`;
}

export function connectionFromConfig(config: {
  dbEngine?: string | null;
  dbClient?: string | null;
  dbContainer?: string | null;
  dbHost?: string | null;
  dbPort?: number | null;
  dbUser?: string | null;
  dbPassword?: string | null;
  sourcePath: string;
}): DatabaseConnection {
  if (!config.dbEngine || !config.dbClient || !config.dbUser) {
    throw new Error('Database backup is missing engine, client, or user');
  }
  return {
    engine: config.dbEngine as DbEngine,
    client: config.dbClient as DbClient,
    container: config.dbContainer,
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.sourcePath,
  };
}

function isFailedExit(code: number | null | undefined): boolean {
  return code !== 0 && code !== null && code !== undefined;
}

export type PackDatabaseResult = {
  archivePath: string;
  tmpDir: string;
  stdout: string;
  stderr: string;
};

async function runLocalShell(
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 2 * 1024 * 1024,
      shell: '/bin/sh',
    });
    return { stdout: stdout || '', stderr: stderr || '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || e.message || 'Command failed',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

/** Dump database to a temp .sql.gz on the local host. Caller must clean up tmpDir. */
export async function packDatabaseDumpLocal(
  conn: DatabaseConnection
): Promise<PackDatabaseResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-db-'));
  const archiveName = archiveFileNameForDatabase(conn.database);
  const archivePath = path.join(tmpDir, archiveName);
  const cmd = buildPackDatabaseCommand(conn, archivePath);
  const result = await runLocalShell(cmd);
  if (result.code !== 0) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to dump database ${conn.database}: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return {
    archivePath,
    tmpDir,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Dump database to a remote temp .sql.gz via SSH. Caller must clean up tmpDir. */
export async function packDatabaseDumpRemote(
  ssh: NodeSSH,
  conn: DatabaseConnection
): Promise<PackDatabaseResult> {
  const mktemp = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} mktemp -d /tmp/lazybackup-db-XXXXXX`
  );
  if (isFailedExit(mktemp.code) || !mktemp.stdout.trim()) {
    throw new Error(`Failed to create remote temp directory: ${mktemp.stderr || mktemp.stdout}`);
  }
  const tmpDir = mktemp.stdout.trim();
  const archiveName = archiveFileNameForDatabase(conn.database);
  const archivePath = `${tmpDir}/${archiveName}`;
  const cmd = buildPackDatabaseCommand(conn, archivePath);
  const packResult = await ssh.execCommand(cmd);
  if (isFailedExit(packResult.code)) {
    await ssh.execCommand(`rm -rf ${shellSingleQuote(tmpDir)}`).catch(() => {});
    throw new Error(
      `Failed to dump database ${conn.database}: ${(packResult.stderr || packResult.stdout).trim()}`
    );
  }
  return {
    archivePath,
    tmpDir,
    stdout: packResult.stdout,
    stderr: packResult.stderr,
  };
}

export async function restoreDatabaseLocal(
  conn: DatabaseConnection,
  archiveFilePath: string
): Promise<{ stdout: string; stderr: string }> {
  const cmd = buildRestoreDatabaseCommand(conn, archiveFilePath);
  const result = await runLocalShell(cmd);
  if (result.code !== 0) {
    throw new Error(
      `Failed to restore database ${conn.database}: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function restoreDatabaseRemote(
  ssh: NodeSSH,
  conn: DatabaseConnection,
  remoteArchivePath: string
): Promise<{ stdout: string; stderr: string }> {
  const cmd = buildRestoreDatabaseCommand(conn, remoteArchivePath);
  const result = await ssh.execCommand(cmd);
  if (isFailedExit(result.code)) {
    throw new Error(
      `Failed to restore database ${conn.database}: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function testDatabaseConnectionLocal(
  conn: DatabaseConnection
): Promise<{ ok: true; stdout: string }> {
  const cmd = buildDatabaseTestCommand(conn);
  const result = await runLocalShell(cmd);
  if (result.code !== 0) {
    throw new Error(`Database connection failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { ok: true, stdout: result.stdout.trim() };
}

export async function testDatabaseConnectionRemote(
  ssh: NodeSSH,
  conn: DatabaseConnection
): Promise<{ ok: true; stdout: string }> {
  const cmd = buildDatabaseTestCommand(conn);
  const result = await ssh.execCommand(cmd);
  if (isFailedExit(result.code)) {
    throw new Error(`Database connection failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { ok: true, stdout: (result.stdout || '').trim() };
}

export async function cleanupLocalDbTmpDir(tmpDir: string): Promise<void> {
  if (!tmpDir.includes('lazybackup-db-')) {
    throw new Error(`Refusing to delete unexpected local path: ${tmpDir}`);
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
}

export async function cleanupRemoteDbTmpDir(ssh: NodeSSH, remoteDir: string): Promise<void> {
  if (!remoteDir.startsWith('/tmp/lazybackup-db-')) {
    throw new Error(`Refusing to delete unexpected remote path: ${remoteDir}`);
  }
  await ssh.execCommand(`rm -rf ${shellSingleQuote(remoteDir)}`);
}
