import { shellSingleQuote } from '@/lib/ssh/rsync';
import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { spawn, execFile, type ChildProcess } from 'child_process';
import { constants as fsConstants, createReadStream, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGzip } from 'zlib';
import type { NodeSSH } from 'node-ssh';

const execFileAsync = promisify(execFile);

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

export type DbEngine = 'postgres' | 'mysql' | 'mariadb' | 'sqlite';
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
  if (engine === 'postgres') return 5432;
  if (engine === 'sqlite') return 0;
  return 3306;
}

export function resolveDbPort(conn: DatabaseConnection): number {
  return conn.port && conn.port > 0 ? conn.port : defaultPortForEngine(conn.engine);
}

export function assertValidDatabaseName(name: string): void {
  if (!DB_NAME_RE.test(name)) {
    throw new Error(`Invalid database name: ${name}. Names must match ${DB_NAME_RE}`);
  }
}

export function assertValidSqlitePath(dbPath: string): void {
  const t = dbPath.trim();
  if (!t) {
    throw new Error('SQLite database path is required');
  }
  if (/[\r\n\0]/.test(t)) {
    throw new Error('Invalid SQLite database path');
  }
  const parts = t.split(/[/\\]/);
  if (parts.includes('..')) {
    throw new Error('SQLite database path must not contain ..');
  }
}

export function isSqliteEngine(engine: string | null | undefined): boolean {
  return engine === 'sqlite';
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

/** Host as seen by the dump client (native binary, or from inside the docker container). */
function effectiveHost(conn: DatabaseConnection): string {
  return (conn.host || '127.0.0.1').trim() || '127.0.0.1';
}

/** pg_dump / mysqldump argv (no env, no gzip). */
export function buildDumpArgv(conn: DatabaseConnection): string[] {
  if (conn.engine === 'sqlite') {
    throw new Error('SQLite dumps use buildPackSqliteCommand, not pg_dump argv');
  }
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

/**
 * MySQL/MariaDB dumps carry `DEFINER=`user`@`host`` clauses for triggers,
 * procedures and views. Restoring them as a non-superuser fails with
 * ERROR 1227 even when the user owns the target database, and the client
 * aborts halfway through (partial restore). Strip the clauses on the way
 * into the client so restored objects belong to the restoring user.
 *
 * Covered dump forms:
 *   CREATE DEFINER=`root`@`localhost` PROCEDURE ...
 *   /*!50017 DEFINER=`root`@`localhost`*\/ /*!50003 TRIGGER ...
 *   /*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER *\/
 * The version comment number varies between dump versions, so match any.
 * POSIX BRE keeps this portable to BusyBox sed on Alpine hosts.
 */
export const MYSQL_DEFINER_STRIP_SED_EXPRESSIONS: readonly string[] = [
  's#/\\*![0-9][0-9]* DEFINER=`[^`]*`@`[^`]*` *SQL SECURITY DEFINER *\\*/##g',
  's#/\\*![0-9][0-9]* DEFINER=`[^`]*`@`[^`]*` *\\*/##g',
  // Plain CREATE/ALTER DEFINER clauses are scoped to lines that start with
  // CREATE/ALTER so DEFINER-looking text inside INSERT data is left alone.
  '/^CREATE/s#DEFINER=`[^`]*`@`[^`]*`##g',
  '/^ALTER/s#DEFINER=`[^`]*`@`[^`]*`##g',
];

/** `sed -e … | ` stage used between gunzip and the MySQL/MariaDB client. */
export function buildMysqlDefinerStripCommand(): string {
  return [
    'sed',
    ...MYSQL_DEFINER_STRIP_SED_EXPRESSIONS.flatMap((expression) => [
      '-e',
      shellSingleQuote(expression),
    ]),
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
      '--single-transaction',
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
 * `docker exec -e NAME` (no `=value`) forwards the variable from the docker
 * CLI's own environment. Keep the value out of argv: `ps` is world-readable,
 * `/proc/<pid>/environ` is only readable by the process owner (and root).
 */
function dockerPasswordEnvFlag(engine: DbEngine): string {
  return `-e ${passwordEnvName(engine)}`;
}

/** Export the password into the docker CLI env from the chmod-600 file. */
function dockerPasswordPrefix(engine: DbEngine, passwordFile: string): string {
  return `${passwordEnvName(engine)}="$(cat ${shellSingleQuote(passwordFile)})"`;
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
/**
 * Pipe `dumpPart` through gzip while still failing when the dump itself failed.
 *
 * A plain `dump | gzip > out` reports gzip's status: a dump that dies after
 * writing a few lines (bad password, missing table, killed process) still leaves
 * a valid gzip and the backup would be recorded as a success. Capture the
 * dump's exit code in a temp file, then require both stages to succeed.
 */
export function buildDumpToGzipWithStatus(
  dumpPart: string,
  archiveFilePath: string
): string {
  const quotedOut = shellSingleQuote(archiveFilePath);
  return [
    'status=$(mktemp /tmp/lazybackup-dbstatus-XXXXXX) || exit 1',
    `{ ${dumpPart}; echo $? > "$status"; } | gzip > ${quotedOut}`,
    'gz=$?',
    'ec=$(cat "$status" 2>/dev/null || echo 1)',
    'rm -f "$status"',
    '[ "$ec" -eq 0 ] && [ "$gz" -eq 0 ]',
  ].join('; ');
}

export function buildPackDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string,
  options?: { passwordFile?: string }
): string {
  if (conn.engine === 'sqlite') {
    return buildPackSqliteCommand(conn.database, archiveFilePath);
  }
  assertValidDatabaseName(conn.database);
  let dumpArgs = buildDumpArgs(conn);
  const passwordFile = options?.passwordFile;

  let dumpPart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordEnvFlag(conn.engine) : '';
    const envPrefix = passwordFile
      ? `${dockerPasswordPrefix(conn.engine, passwordFile)} `
      : '';
    dumpPart =
      `${envPrefix}docker exec ${envFlag} ${shellSingleQuote(container)} ${dumpArgs}`.replace(
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

  return buildDumpToGzipWithStatus(`${REMOTE_STANDARD_PATH} ${dumpPart}`, archiveFilePath);
}

export function buildRestoreDatabaseCommand(
  conn: DatabaseConnection,
  archiveFilePath: string,
  options?: { passwordFile?: string }
): string {
  if (conn.engine === 'sqlite') {
    return buildRestoreSqliteCommand(conn.database, archiveFilePath);
  }
  assertValidDatabaseName(conn.database);
  const quotedIn = shellSingleQuote(archiveFilePath);
  let clientArgs = buildRestoreClientArgs(conn);
  const passwordFile = options?.passwordFile;

  let restorePart: string;
  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordEnvFlag(conn.engine) : '';
    const envPrefix = passwordFile
      ? `${dockerPasswordPrefix(conn.engine, passwordFile)} `
      : '';
    restorePart =
      `${envPrefix}docker exec -i ${envFlag} ${shellSingleQuote(container)} ${clientArgs}`.replace(
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

  // MySQL/MariaDB dumps embed the dumping user's DEFINER; restoring them as a
  // non-superuser fails with ERROR 1227 and leaves a partial restore. Strip
  // the clauses before the client parses them so objects use the restore user.
  const definerStrip =
    conn.engine === 'mysql' || conn.engine === 'mariadb'
      ? `${buildMysqlDefinerStripCommand()} | `
      : '';

  // Verify the whole archive before the client sees a byte: `gzip -dc | client`
  // reports only the client's exit status, so a truncated/corrupt dump would
  // otherwise be restored partially and reported as success.
  return `${REMOTE_STANDARD_PATH} gzip -t ${quotedIn} && gzip -dc ${quotedIn} | ${definerStrip}${restorePart}`;
}

export function buildDatabaseTestCommand(
  conn: DatabaseConnection,
  options?: { passwordFile?: string }
): string {
  if (conn.engine === 'sqlite') {
    return buildSqliteTestCommand(conn.database);
  }
  assertValidDatabaseName(conn.database);
  let testArgs = buildTestClientArgs(conn);
  const passwordFile = options?.passwordFile;

  if (conn.client === 'docker') {
    const container = requireContainer(conn);
    const envFlag = passwordFile ? dockerPasswordEnvFlag(conn.engine) : '';
    const envPrefix = passwordFile
      ? `${dockerPasswordPrefix(conn.engine, passwordFile)} `
      : '';
    return [
      `${envPrefix}${REMOTE_STANDARD_PATH}`,
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

/**
 * Engine family encoded in a landed dump name (`app.sql.gz` vs `app.sqlite.gz`,
 * optionally age-wrapped). Used to refuse restoring a legacy run whose live
 * config was later edited to a different engine.
 */
export function databaseArtifactEngine(
  artifactPath: string
): 'sqlite' | 'server' | null {
  const base = artifactPath.split(/[/\\]/).pop() || '';
  const name = base.replace(/\.age$/i, '');
  if (/\.sqlite\.gz$/i.test(name)) return 'sqlite';
  if (/\.sql\.gz$/i.test(name)) return 'server';
  return null;
}

export function archiveFileNameForDatabase(
  database: string,
  engine?: DbEngine | null
): string {
  if (engine === 'sqlite') {
    assertValidSqlitePath(database);
    const base = path.basename(database.trim()) || 'database';
    const stem = base.replace(/\.(sqlite3?|db|sqlite\.gz)$/i, '');
    return `${stem || 'database'}.sqlite.gz`;
  }
  assertValidDatabaseName(database);
  return `${database}.sql.gz`;
}

/** Copy or sqlite3 .backup, then gzip to .sqlite.gz. Native only. */
export function buildPackSqliteCommand(dbPath: string, archiveFilePath: string): string {
  assertValidSqlitePath(dbPath);
  const quotedDb = shellSingleQuote(dbPath.trim());
  const quotedOut = shellSingleQuote(archiveFilePath);
  return [
    REMOTE_STANDARD_PATH,
    'tmp=$(mktemp /tmp/lazybackup-sqlite-XXXXXX)',
    `; if command -v sqlite3 >/dev/null 2>&1; then sqlite3 ${quotedDb} ".backup $tmp"; else echo ${shellSingleQuote(
      'WARNING: sqlite3 is not installed on the source host; falling back to cp of the live SQLite file. The backup can be inconsistent if the database is being written. Install sqlite3 for a consistent snapshot.'
    )} >&2; cp ${quotedDb} "$tmp"; fi`,
    `&& gzip -c "$tmp" > ${quotedOut}`,
    '; ec=$?; rm -f "$tmp"; exit $ec',
  ].join(' ');
}

/** `VACUUM INTO` statement for a consistent SQLite snapshot (quoting is SQL, not shell). */
export function buildSqliteVacuumIntoStatement(targetPath: string): string {
  const t = targetPath.trim();
  if (!t) {
    throw new Error('SQLite snapshot path is required');
  }
  return `VACUUM INTO '${t.replace(/'/g, "''")}'`;
}

async function localSqlite3Available(): Promise<boolean> {
  try {
    await execFileAsync('sqlite3', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Short, user-facing message: backup logs must never show a Node stack. */
export const BUN_RUNTIME_UNAVAILABLE_MESSAGE =
  'A consistent SQLite snapshot needs the Bun runtime (bun not found on PATH)';

export class BunRuntimeUnavailableError extends Error {
  constructor(message: string = BUN_RUNTIME_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'BunRuntimeUnavailableError';
  }
}

let bunBinaryPromise: Promise<string | null> | null = null;

/** Test hook: forget the cached Bun path after PATH / BUN_BINARY changes. */
export function resetBunBinaryCacheForTests(): void {
  bunBinaryPromise = null;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return false;
    await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path to a Bun binary that can run a `bun -e` script.
 *
 * Development and the Docker image run this app under Bun, but `next start`
 * runs on Node, where `process.execPath` is `node`. Fall back to an explicit
 * override, then `bun` on PATH, then the default install location. Resolved
 * once per process: the binary does not change while the server runs.
 */
export async function resolveBunBinary(): Promise<string | null> {
  if (process.versions.bun) {
    return process.execPath;
  }
  bunBinaryPromise ??= (async () => {
    const override = process.env.BUN_BINARY?.trim();
    if (override && (await isExecutableFile(override))) {
      return override;
    }
    const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
    // No shell: a PATH entry must not be able to expand into a command line.
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!dir) continue;
      const candidate = path.join(dir, exe);
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
    // os.homedir() is cached at startup under Bun; read HOME first so tests
    // (and containers that export HOME at runtime) resolve the same place.
    const home = process.env.HOME?.trim() || os.homedir();
    const installed = path.join(home, '.bun', 'bin', exe);
    if (await isExecutableFile(installed)) {
      return installed;
    }
    return null;
  })();
  return bunBinaryPromise;
}

/** First line of tool output that names a failure, never a stack frame. */
function commandFailureMessage(stdout: string, stderr: string, code: number): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // Bun prints a source frame before the actual error line.
  const line =
    lines.find((candidate) => /^[A-Za-z_]*Error\b|^error:/i.test(candidate)) ?? lines[0];
  const reason = line || `exit ${code}`;
  return reason.length > 200 ? `${reason.slice(0, 199)}…` : reason;
}

/**
 * Write a transactionally consistent copy of a live SQLite database using
 * Bun's bundled SQLite in a short-lived `bun -e` process (`VACUUM INTO`).
 * Copying the main file alone while WAL mode is active misses recent commits.
 */
export async function snapshotSqliteLocal(
  dbPath: string,
  snapshotPath: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  assertValidSqlitePath(dbPath);
  const bun = await resolveBunBinary();
  if (!bun) {
    throw new BunRuntimeUnavailableError();
  }
  const source = dbPath.trim();
  const script = `
import { Database } from 'bun:sqlite';
const db = new Database(process.env.LAZYBACKUP_SQLITE_SOURCE, { readonly: true });
try {
  db.run('PRAGMA busy_timeout = 5000');
  db.run(process.env.LAZYBACKUP_SQLITE_VACUUM_SQL);
} finally {
  db.close();
}
`;
  const result = await runArgv([bun, '-e', script], {
    ...process.env,
    LAZYBACKUP_SQLITE_SOURCE: source,
    LAZYBACKUP_SQLITE_VACUUM_SQL: buildSqliteVacuumIntoStatement(snapshotPath),
  });
  if (result.code !== 0) {
    throw new Error(commandFailureMessage(result.stdout, result.stderr, result.code));
  }
  return result;
}

/**
 * Consistent local SQLite snapshot without the sqlite3 CLI, used when the
 * Docker image/dev host has no sqlite3 binary. Snapshots with
 * {@link snapshotSqliteLocal} and gzips the result, so a live database is
 * never copied mid-write.
 */
export async function packSqliteSnapshotLocal(
  dbPath: string,
  archiveFilePath: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  assertValidSqlitePath(dbPath);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-sqlite-'));
  const snapshotPath = path.join(tmpDir, 'snapshot.db');
  try {
    const result = await snapshotSqliteLocal(dbPath, snapshotPath);
    await pipeline(
      createReadStream(snapshotPath),
      createGzip(),
      createWriteStream(archiveFilePath, { mode: 0o600 })
    );
    await fs.chmod(archiveFilePath, 0o600).catch(() => undefined);
    return { ...result, stderr: result.stderr };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildRestoreSqliteCommand(dbPath: string, archiveFilePath: string): string {
  assertValidSqlitePath(dbPath);
  const target = dbPath.trim();
  const quotedDb = shellSingleQuote(target);
  const quotedIn = shellSingleQuote(archiveFilePath);
  const tempTemplate = shellSingleQuote(`${target}.restore-XXXXXX`);
  // A replaced database must not inherit rollback/WAL sidecars from the old
  // file: SQLite would replay frames that belong to the previous database into
  // the restored one.
  const staleSidecars = ['-wal', '-shm', '-journal']
    .map((suffix) => shellSingleQuote(`${target}${suffix}`))
    .join(' ');
  // Decompress next to the target and rename only on success. Writing the
  // archive straight over the live file truncates it even when gzip fails
  // halfway, destroying the database the restore was supposed to fix.
  return [
    `${REMOTE_STANDARD_PATH} mkdir -p "$(dirname -- ${quotedDb})"`,
    `&& tmp=$(mktemp ${tempTemplate})`,
    `&& { gzip -dc ${quotedIn} > "$tmp" && mv -f "$tmp" ${quotedDb} && rm -f ${staleSidecars}; ec=$?`,
    `; [ "$ec" -eq 0 ] || rm -f "$tmp"; exit "$ec"; }`,
  ].join(' ');
}

export function buildSqliteTestCommand(dbPath: string): string {
  assertValidSqlitePath(dbPath);
  const quotedDb = shellSingleQuote(dbPath.trim());
  return [
    REMOTE_STANDARD_PATH,
    `test -r ${quotedDb}`,
    `&& if command -v sqlite3 >/dev/null 2>&1; then sqlite3 ${quotedDb} 'SELECT 1'; fi`,
  ].join(' ');
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
  if (!config.dbEngine || !config.dbClient) {
    throw new Error('Database backup is missing engine or client');
  }
  if (config.dbEngine === 'sqlite') {
    assertValidSqlitePath(config.sourcePath);
    if (config.dbClient === 'docker') {
      throw new Error('SQLite dumps are native-only (no docker client)');
    }
    return {
      engine: 'sqlite',
      client: 'native',
      container: null,
      host: null,
      port: null,
      user: config.dbUser?.trim() || 'sqlite',
      password: null,
      database: config.sourcePath.trim(),
    };
  }
  if (!config.dbUser) {
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

function isFailedExit(result: {
  code?: number | null;
  signal?: string | null;
}): boolean {
  // node-ssh reports code=null when the remote command is killed; a signal
  // means the command did not finish, so the operation must not be called a
  // success (a SIGKILLed psql leaves a partially restored database).
  if (result.signal) return true;
  const code = result.code;
  return code !== 0 && code !== null && code !== undefined;
}

export type PackDatabaseResult = {
  archivePath: string;
  tmpDir: string;
  stdout: string;
  stderr: string;
};

function collectStd(child: ChildProcess): {
  stdout: string;
  stderr: string;
} {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
  return {
    get stdout() {
      return Buffer.concat(out).toString('utf8');
    },
    get stderr() {
      return Buffer.concat(err).toString('utf8');
    },
  };
}

function waitChild(child: ChildProcess): Promise<number> {
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
    // mktemp gives a 0700 dir, so the SFTP-created file is not world-readable
    // even before the chmod below lands.
    const made = await ssh.execCommand(
      `${REMOTE_STANDARD_PATH} mktemp -d /tmp/lazybackup-dbpw-XXXXXX`
    );
    const remoteDir = made.stdout.trim();
    if (isFailedExit(made) || !remoteDir) {
      throw new Error(
        `Failed to create remote password file: ${made.stderr || made.stdout}`
      );
    }
    const remote = `${remoteDir}/pw`;
    try {
      await ssh.putFile(localFile, remote);
      await ssh.execCommand(
        `chmod 700 ${shellSingleQuote(remoteDir)} && chmod 600 ${shellSingleQuote(remote)}`
      );
      return await fn(remote);
    } finally {
      await ssh
        .execCommand(`rm -rf ${shellSingleQuote(remoteDir)}`)
        .catch(() => {});
    }
  });
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

/**
 * One short line naming why a snapshot failed, for the backup log. Error
 * messages from spawned tools can carry a whole Node/Bun stack; a warning
 * embedded in the log must not.
 */
function compactErrorReason(error: unknown, max = 200): string {
  if (!(error instanceof Error)) return 'snapshot failed';
  const code = (error as NodeJS.ErrnoException).code;
  const firstLine = error.message.split(/\r?\n/, 1)[0]?.trim();
  const reason = firstLine || code || 'snapshot failed';
  return reason.length > max ? `${reason.slice(0, max - 1)}…` : reason;
}

/**
 * One-line warning prepended to a SQLite dump when the consistent snapshot is
 * unavailable. The spawned runtime can print a multi-line stack; only the
 * reason (first line / code) belongs in a user-visible backup log.
 */
export function formatSqliteFallbackWarning(error: unknown): string {
  return `SQLite consistent snapshot unavailable (${compactErrorReason(error)}); using cp fallback`;
}

/** Dump database to a temp .sql.gz on the local host. Caller must clean up tmpDir. */
export async function packDatabaseDumpLocal(
  conn: DatabaseConnection
): Promise<PackDatabaseResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-db-'));
  const archiveName = archiveFileNameForDatabase(conn.database, conn.engine);
  const archivePath = path.join(tmpDir, archiveName);
  try {
    let result: { stdout: string; stderr: string; code: number };
    if (conn.engine === 'sqlite') {
      if (await localSqlite3Available()) {
        const cmd = buildPackDatabaseCommand(conn, archivePath);
        result = await runArgv(['/bin/sh', '-c', cmd], { ...process.env });
      } else {
        try {
          result = await packSqliteSnapshotLocal(conn.database, archivePath);
        } catch (snapshotError) {
          // Non-Bun runtime (or an SQLite too old for VACUUM INTO): the shell
          // command warns and copies the live file. Keep that warning in the
          // dump stderr so it reaches the backup log, and say why.
          const fallback = await runArgv(
            ['/bin/sh', '-c', buildPackDatabaseCommand(conn, archivePath)],
            { ...process.env }
          );
          result = {
            ...fallback,
            stderr: `${formatSqliteFallbackWarning(snapshotError)}\n${fallback.stderr}`,
          };
        }
      }
    } else if (conn.client === 'docker') {
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
    // Shell redirects (docker/sqlite paths) create with the process umask; the
    // archive holds full DB contents, so always restrict it to the owner.
    await fs.chmod(archivePath, 0o600).catch(() => undefined);
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
  if (isFailedExit(mktemp) || !mktemp.stdout.trim()) {
    throw new Error(`Failed to create remote temp directory: ${mktemp.stderr || mktemp.stdout}`);
  }
  const tmpDir = mktemp.stdout.trim();
  const archiveName = archiveFileNameForDatabase(conn.database, conn.engine);
  const archivePath = `${tmpDir}/${archiveName}`;
  try {
    const packResult =
      conn.engine === 'sqlite'
        ? await ssh.execCommand(buildPackDatabaseCommand(conn, archivePath))
        : await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
            const cmd = buildPackDatabaseCommand(conn, archivePath, { passwordFile });
            return ssh.execCommand(cmd);
          });
    if (isFailedExit(packResult)) {
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
  if (conn.engine === 'sqlite') {
    const cmd = buildRestoreDatabaseCommand(conn, archiveFilePath);
    const result = await runArgv(['/bin/sh', '-c', cmd], { ...process.env });
    if (result.code !== 0) {
      throw new Error(
        `Failed to restore database ${conn.database}: ${(result.stderr || result.stdout).trim()}`
      );
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }
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

  // Native restore runs the same verified pipeline as remote/docker restores:
  // gzip integrity check, MySQL/MariaDB DEFINER stripping, and
  // ON_ERROR_STOP + --single-transaction for PostgreSQL. Passwords still come
  // from the environment (PGPASSWORD / MYSQL_PWD), never argv.
  const result = await runArgv(
    ['/bin/sh', '-c', buildRestoreDatabaseCommand(conn, archiveFilePath)],
    localPasswordEnv(conn)
  );
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
  const result =
    conn.engine === 'sqlite'
      ? await ssh.execCommand(buildRestoreDatabaseCommand(conn, remoteArchivePath))
      : await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
          const cmd = buildRestoreDatabaseCommand(conn, remoteArchivePath, { passwordFile });
          return ssh.execCommand(cmd);
        });
  if (isFailedExit(result)) {
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
  if (conn.engine === 'sqlite') {
    const cmd = buildDatabaseTestCommand(conn);
    result = await runArgv(['/bin/sh', '-c', cmd], { ...process.env });
  } else if (conn.client === 'docker') {
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
  const result =
    conn.engine === 'sqlite'
      ? await ssh.execCommand(buildDatabaseTestCommand(conn))
      : await withRemotePasswordFile(ssh, conn, async (passwordFile) => {
          const cmd = buildDatabaseTestCommand(conn, { passwordFile });
          return ssh.execCommand(cmd);
        });
  if (isFailedExit(result)) {
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
