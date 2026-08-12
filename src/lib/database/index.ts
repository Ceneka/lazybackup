import { shellSingleQuote } from '@/lib/ssh/rsync';
import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { NodeSSH } from 'node-ssh';

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

function passwordEnvName(engine: DbEngine): 'PGPASSWORD' | 'MYSQL_PWD' {
  return engine === 'postgres' ? 'PGPASSWORD' : 'MYSQL_PWD';
}

function assertSafeSecret(password: string): void {
  if (/[\r\n\0]/.test(password)) {
    throw new Error('Database password contains invalid characters');
  }
}

/** libpq pgpass: hostname:port:database:username:password */
export function buildPgpassContents(conn: DatabaseConnection): string {
  const password = conn.password ?? '';
  assertSafeSecret(password);
  const escaped = password.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return `*:*:${conn.database}:${conn.user}:${escaped}\n`;
}

/** MySQL/MariaDB defaults file used via --defaults-extra-file (not argv password). */
export function buildMysqlDefaultsContents(conn: DatabaseConnection): string {
  const password = conn.password ?? '';
  assertSafeSecret(password);
  const escaped = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[client]\npassword="${escaped}"\n`;
}

export function passwordFileContents(conn: DatabaseConnection): string {
  if (conn.client === 'docker' || conn.engine === 'postgres') {
    if (conn.client === 'docker') {
      assertSafeSecret(conn.password ?? '');
      return `${conn.password ?? ''}\n`;
    }
    return buildPgpassContents(conn);
  }
  return buildMysqlDefaultsContents(conn);
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
export function buildDumpArgv(conn: DatabaseConnection): string[] {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  const user = conn.user;
  const db = conn.database;

  if (conn.engine === 'postgres') {
    return [
      dumpBinary(conn.engine),
      '-h',
      host,
      '-p',
      String(port),
      '-U',
      user,
      '-d',
      db,
      '--no-owner',
      '--no-acl',
    ];
  }

  return [
    dumpBinary(conn.engine),
    '-h',
    host,
    '-P',
    String(port),
    '-u',
    user,
    '--single-transaction',
    '--routines',
    '--triggers',
    db,
  ];
}

/** Quoted remote-shell dump command (no password). */
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

function dockerPasswordFromFileFlag(engine: DbEngine, passwordFile: string): string {
  const envName = passwordEnvName(engine);
  return `-e ${envName}="$(cat ${shellSingleQuote(passwordFile)})"`;
}

function nativePasswordPrefix(conn: DatabaseConnection, passwordFile: string): string {
  if (conn.engine === 'postgres') {
    return `PGPASSFILE=${shellSingleQuote(passwordFile)}`;
  }
  return '';
}

function withMysqlDefaultsFile(dumpArgs: string, passwordFile: string, engine: DbEngine): string {
  const bin = dumpBinary(engine);
  return dumpArgs.replace(
    bin,
    `${bin} --defaults-extra-file=${shellSingleQuote(passwordFile)}`
  );
}

/**
 * Host-side command that dumps to archiveFilePath (.sql.gz).
 * Password is never interpolated: pass a chmod-600 file via `passwordFile`.
 */
export function buildPackDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string,
  options?: { passwordFile?: string }
): string {
  assertValidDatabaseName(conn.database);
  const quotedOut = shellSingleQuote(archiveFilePath);
  let dumpArgs = buildDumpArgs(conn);
  const passwordFile = options?.passwordFile;

  let dumpPart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordFromFileFlag(conn.engine, passwordFile) : '';
    dumpPart = `docker exec ${envFlag} ${shellSingleQuote(container)} ${dumpArgs}`.replace(
      /  +/g,
      ' '
    );
  } else if (passwordFile && conn.engine === 'postgres') {
    dumpPart = `${nativePasswordPrefix(conn, passwordFile)} ${dumpArgs}`;
  } else if (passwordFile) {
    dumpPart = withMysqlDefaultsFile(dumpArgs, passwordFile, conn.engine);
  } else {
    dumpPart = dumpArgs;
  }

  return `${REMOTE_STANDARD_PATH} ${dumpPart} | gzip > ${quotedOut}`;
}

export function buildRestoreDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string,
  options?: { passwordFile?: string }
): string {
  assertValidDatabaseName(conn.database);
  const quotedIn = shellSingleQuote(archiveFilePath);
  let clientArgs = buildRestoreClientArgs(conn);
  const passwordFile = options?.passwordFile;

  let restorePart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordFromFileFlag(conn.engine, passwordFile) : '';
    restorePart = `docker exec -i ${envFlag} ${shellSingleQuote(container)} ${clientArgs}`.replace(
      /  +/g,
      ' '
    );
  } else if (passwordFile && conn.engine === 'postgres') {
    restorePart = `${nativePasswordPrefix(conn, passwordFile)} ${clientArgs}`;
  } else if (passwordFile) {
    const bin = clientBinary(conn.engine);
    clientArgs = clientArgs.replace(
      bin,
      `${bin} --defaults-extra-file=${shellSingleQuote(passwordFile)}`
    );
    restorePart = clientArgs;
  } else {
    restorePart = clientArgs;
  }

  return `${REMOTE_STANDARD_PATH} gzip -dc ${quotedIn} | ${restorePart}`;
}

export function buildDatabaseTestCommand(
  conn: DatabaseConnection,
  options?: { passwordFile?: string }
): string {
  assertValidDatabaseName(conn.database);
  let testArgs = buildTestClientArgs(conn);
  const passwordFile = options?.passwordFile;

  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordFromFileFlag(conn.engine, passwordFile) : '';
    return [
      REMOTE_STANDARD_PATH,
      'docker exec',
      envFlag,
      shellSingleQuote(container),
      testArgs,
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (passwordFile && conn.engine === 'postgres') {
    return `${REMOTE_STANDARD_PATH} ${nativePasswordPrefix(conn, passwordFile)} ${testArgs}`;
  }
  if (passwordFile) {
    const bin = clientBinary(conn.engine);
    testArgs = testArgs.replace(
      bin,
      `${bin} --defaults-extra-file=${shellSingleQuote(passwordFile)}`
    );
  }
  return `${REMOTE_STANDARD_PATH} ${testArgs}`;
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

function collectStd(child: ChildProcessWithoutNullStreams): {
  stdout: string;
  stderr: string;
} {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
  return {
    get stdout() {
      return Buffer.concat(out).toString('utf8');
    },
    get stderr() {
      return Buffer.concat(err).toString('utf8');
    },
  };
}

function waitChild(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function localPasswordEnv(conn: DatabaseConnection): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const password = conn.password ?? '';
  if (password) {
    assertSafeSecret(password);
    env[passwordEnvName(conn.engine)] = password;
  }
  return env;
}

async function pipeDumpToGzip(
  argv: string[],
  archivePath: string,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number }> {
  const [bin, ...args] = argv;
  const dump = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const gzip = spawn('gzip', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const out = createWriteStream(archivePath, { mode: 0o600 });
  dump.stdout.pipe(gzip.stdin);
  gzip.stdout.pipe(out);
  const dumpStd = collectStd(dump);
  const gzipStd = collectStd(gzip);
  const [dumpCode, gzipCode] = await Promise.all([waitChild(dump), waitChild(gzip)]);
  await new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    out.end();
  }).catch(() => undefined);
  const stderr = `${dumpStd.stderr}${gzipStd.stderr}`;
  const stdout = `${dumpStd.stdout}${gzipStd.stdout}`;
  return { stdout, stderr, code: dumpCode !== 0 ? dumpCode : gzipCode };
}

async function withLocalPasswordFile<T>(
  conn: DatabaseConnection,
  fn: (passwordFile: string) => Promise<T>
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-dbpw-'));
  const file = path.join(dir, 'pw');
  await fs.writeFile(file, passwordFileContents(conn), { mode: 0o600 });
  await fs.chmod(file, 0o600);
  try {
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function withRemotePasswordFile<T>(
  ssh: NodeSSH,
  conn: DatabaseConnection,
  fn: (passwordFile: string) => Promise<T>
): Promise<T> {
  return withLocalPasswordFile(conn, async (localFile) => {
    const remote = `/tmp/lazybackup-dbpw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await ssh.putFile(localFile, remote);
      await ssh.execCommand(`chmod 600 ${shellSingleQuote(remote)}`);
      return await fn(remote);
    } finally {
      await ssh.execCommand(`rm -f ${shellSingleQuote(remote)}`).catch(() => {});
    }
  });
}

function restoreClientArgv(conn: DatabaseConnection): string[] {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  if (conn.engine === 'postgres') {
    return [
      clientBinary(conn.engine),
      '-h',
      host,
      '-p',
      String(port),
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-v',
      'ON_ERROR_STOP=1',
    ];
  }
  return [
    clientBinary(conn.engine),
    '-h',
    host,
    '-P',
    String(port),
    '-u',
    conn.user,
    conn.database,
  ];
}

function testClientArgv(conn: DatabaseConnection): string[] {
  assertValidDatabaseName(conn.database);
  const host = effectiveHost(conn);
  const port = resolveDbPort(conn);
  if (conn.engine === 'postgres') {
    return [
      clientBinary(conn.engine),
      '-h',
      host,
      '-p',
      String(port),
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-tAc',
      'SELECT 1',
    ];
  }
  return [
    clientBinary(conn.engine),
    '-h',
    host,
    '-P',
    String(port),
    '-u',
    conn.user,
    '-N',
    '-e',
    'SELECT 1',
    conn.database,
  ];
}

async function runArgv(
  argv: string[],
  env: NodeJS.ProcessEnv,
  stdin?: NodeJS.ReadableStream
): Promise<{ stdout: string; stderr: string; code: number }> {
  const [bin, ...args] = argv;
  const child = spawn(bin, args, { env, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (stdin && child.stdin) {
    stdin.pipe(child.stdin);
  }
  const std = collectStd(child);
  const code = await waitChild(child);
  return { stdout: std.stdout, stderr: std.stderr, code };
}

/** Dump database to a temp .sql.gz on the local host. Caller must clean up tmpDir. */
export async function packDatabaseDumpLocal(
  conn: DatabaseConnection
): Promise<PackDatabaseResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-db-'));
  const archiveName = archiveFileNameForDatabase(conn.database);
  const archivePath = path.join(tmpDir, archiveName);
  try {
    let result: { stdout: string; stderr: string; code: number };
    if (conn.client === 'docker') {
      result = await withLocalPasswordFile(conn, async (passwordFile) => {
        const cmd = buildPackDatabaseCommand(conn, archivePath, { passwordFile });
        return runArgv(['/bin/sh', '-c', cmd], { ...process.env });
      });
    } else {
      result = await pipeDumpToGzip(buildDumpArgv(conn), archivePath, localPasswordEnv(conn));
    }
    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout).trim() || `exit ${result.code}`);
    }
    return {
      archivePath,
      tmpDir,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to dump database ${conn.database}: ${
        error instanceof Error ? error.message : 'Command failed'
      }`
    );
  }
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
  try {
    const packResult = await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
      const cmd = buildPackDatabaseCommand(conn, archivePath, { passwordFile });
      return ssh.execCommand(cmd);
    });
    if (isFailedExit(packResult.code)) {
      throw new Error((packResult.stderr || packResult.stdout).trim() || 'dump failed');
    }
    return {
      archivePath,
      tmpDir,
      stdout: packResult.stdout,
      stderr: packResult.stderr,
    };
  } catch (error) {
    await ssh.execCommand(`rm -rf ${shellSingleQuote(tmpDir)}`).catch(() => {});
    throw new Error(
      `Failed to dump database ${conn.database}: ${
        error instanceof Error ? error.message : 'Command failed'
      }`
    );
  }
}

export async function restoreDatabaseLocal(
  conn: DatabaseConnection,
  archiveFilePath: string
): Promise<{ stdout: string; stderr: string }> {
  if (conn.client === 'docker') {
    const result = await withLocalPasswordFile(conn, async (passwordFile) => {
      const cmd = buildRestoreDatabaseCommand(conn, archiveFilePath, { passwordFile });
      return runArgv(['/bin/sh', '-c', cmd], { ...process.env });
    });
    if (result.code !== 0) {
      throw new Error(
        `Failed to restore database ${conn.database}: ${(result.stderr || result.stdout).trim()}`
      );
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }

  const gzip = spawn('gzip', ['-dc', archiveFilePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const client = spawn(restoreClientArgv(conn)[0], restoreClientArgv(conn).slice(1), {
    env: localPasswordEnv(conn),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  gzip.stdout.pipe(client.stdin);
  const gzipStd = collectStd(gzip);
  const clientStd = collectStd(client);
  const [gzipCode, clientCode] = await Promise.all([waitChild(gzip), waitChild(client)]);
  if (gzipCode !== 0 || clientCode !== 0) {
    throw new Error(
      `Failed to restore database ${conn.database}: ${(clientStd.stderr || gzipStd.stderr).trim()}`
    );
  }
  return { stdout: clientStd.stdout, stderr: clientStd.stderr };
}

export async function restoreDatabaseRemote(
  ssh: NodeSSH,
  conn: DatabaseConnection,
  remoteArchivePath: string
): Promise<{ stdout: string; stderr: string }> {
  const result = await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
    const cmd = buildRestoreDatabaseCommand(conn, remoteArchivePath, { passwordFile });
    return ssh.execCommand(cmd);
  });
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
  let result: { stdout: string; stderr: string; code: number };
  if (conn.client === 'docker') {
    result = await withLocalPasswordFile(conn, async (passwordFile) => {
      const cmd = buildDatabaseTestCommand(conn, { passwordFile });
      return runArgv(['/bin/sh', '-c', cmd], { ...process.env });
    });
  } else {
    result = await runArgv(testClientArgv(conn), localPasswordEnv(conn));
  }
  if (result.code !== 0) {
    throw new Error(`Database connection failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { ok: true, stdout: result.stdout.trim() };
}

export async function testDatabaseConnectionRemote(
  ssh: NodeSSH,
  conn: DatabaseConnection
): Promise<{ ok: true; stdout: string }> {
  const result = await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
    const cmd = buildDatabaseTestCommand(conn, { passwordFile });
    return ssh.execCommand(cmd);
  });
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
