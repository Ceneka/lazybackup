import {
  assertDockerAvailable,
  DOCKER_VOLUME_NAME_RE,
  isValidDockerVolumeName,
} from '@/lib/docker/volumes';
import { shellSingleQuote } from '@/lib/ssh/rsync';
import type { NodeSSH } from 'node-ssh';

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

export type DatabaseEngineHint = 'postgres' | 'mysql' | 'mariadb';

export type ContainerDatabaseHints = {
  container: string;
  engine?: DatabaseEngineHint;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
  image?: string;
  /** True when at least one credential/engine field was inferred */
  found: boolean;
  /** Set by the db-hints API; password itself is session-only */
  hasPassword?: boolean;
};

/**
 * Pure mapping from container env + image → DB connection hints.
 * Exported for unit tests.
 */
export function mapContainerEnvToDatabaseHints(
  container: string,
  env: Record<string, string>,
  image?: string
): ContainerDatabaseHints {
  const imageLower = (image || '').toLowerCase();
  let engine: DatabaseEngineHint | undefined;

  if (
    env.POSTGRES_USER ||
    env.POSTGRES_PASSWORD ||
    env.POSTGRES_DB ||
    env.POSTGRES_PORT ||
    imageLower.includes('postgres') ||
    imageLower.includes('postgis')
  ) {
    engine = 'postgres';
  } else if (
    env.MARIADB_USER ||
    env.MARIADB_PASSWORD ||
    env.MARIADB_DATABASE ||
    env.MARIADB_ROOT_PASSWORD ||
    imageLower.includes('mariadb')
  ) {
    engine = 'mariadb';
  } else if (
    env.MYSQL_USER ||
    env.MYSQL_PASSWORD ||
    env.MYSQL_DATABASE ||
    env.MYSQL_ROOT_PASSWORD ||
    imageLower.includes('mysql')
  ) {
    engine = 'mysql';
  }

  let user: string | undefined;
  let password: string | undefined;
  let database: string | undefined;
  let port: number | undefined;

  if (engine === 'postgres') {
    user = firstNonEmpty(env.POSTGRES_USER) || 'postgres';
    password = firstNonEmpty(env.POSTGRES_PASSWORD);
    database = firstNonEmpty(env.POSTGRES_DB) || user;
    port = parsePort(env.POSTGRES_PORT) ?? 5432;
  } else if (engine === 'mariadb') {
    user =
      firstNonEmpty(env.MARIADB_USER) ||
      firstNonEmpty(env.MYSQL_USER) ||
      (firstNonEmpty(env.MARIADB_ROOT_PASSWORD) || firstNonEmpty(env.MYSQL_ROOT_PASSWORD)
        ? 'root'
        : undefined);
    password =
      firstNonEmpty(env.MARIADB_PASSWORD) ||
      firstNonEmpty(env.MYSQL_PASSWORD) ||
      firstNonEmpty(env.MARIADB_ROOT_PASSWORD) ||
      firstNonEmpty(env.MYSQL_ROOT_PASSWORD);
    database =
      firstNonEmpty(env.MARIADB_DATABASE) || firstNonEmpty(env.MYSQL_DATABASE);
    port = parsePort(env.MARIADB_PORT) ?? parsePort(env.MYSQL_PORT) ?? 3306;
  } else if (engine === 'mysql') {
    user =
      firstNonEmpty(env.MYSQL_USER) ||
      (firstNonEmpty(env.MYSQL_ROOT_PASSWORD) ? 'root' : undefined);
    password =
      firstNonEmpty(env.MYSQL_PASSWORD) || firstNonEmpty(env.MYSQL_ROOT_PASSWORD);
    database = firstNonEmpty(env.MYSQL_DATABASE);
    port = parsePort(env.MYSQL_PORT) ?? 3306;
  }

  const found = Boolean(engine || user || password || database);

  return {
    container,
    engine,
    user,
    password,
    database,
    port,
    image: image || undefined,
    found,
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return undefined;
  return n;
}

/** Parse `KEY=VALUE` lines from docker inspect Config.Env */
export function parseDockerEnvArray(envLines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of envLines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

export async function listDockerContainers(ssh: NodeSSH): Promise<string[]> {
  await assertDockerAvailable(ssh);
  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} docker ps --format '{{.Names}}'`
  );
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    const detail = (result.stderr || result.stdout || 'docker ps failed').trim();
    throw new Error(`Failed to list Docker containers: ${detail}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Inspect a running/existing container and infer DB connection hints from env + image.
 */
export async function inspectContainerDatabaseHints(
  ssh: NodeSSH,
  containerName: string
): Promise<ContainerDatabaseHints> {
  if (!isValidDockerVolumeName(containerName)) {
    throw new Error(
      `Invalid Docker container name: ${containerName}. Names must match ${DOCKER_VOLUME_NAME_RE}`
    );
  }
  await assertDockerAvailable(ssh);

  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} docker inspect ${shellSingleQuote(containerName)} --format '{{json .}}'`
  );
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    const detail = (result.stderr || result.stdout || 'docker inspect failed').trim();
    throw new Error(`Failed to inspect container ${containerName}: ${detail}`);
  }

  let parsed: {
    Config?: { Env?: string[]; Image?: string };
    Image?: string;
  };
  try {
    parsed = JSON.parse(result.stdout.trim()) as typeof parsed;
  } catch {
    throw new Error(`Failed to parse docker inspect output for ${containerName}`);
  }

  const envLines = parsed.Config?.Env || [];
  const env = parseDockerEnvArray(envLines);
  const image = parsed.Config?.Image || parsed.Image || '';

  return mapContainerEnvToDatabaseHints(containerName, env, image);
}
