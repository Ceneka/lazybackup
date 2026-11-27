import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { shellSingleQuote } from '@/lib/ssh/rsync';
import type { NodeSSH } from 'node-ssh';

const execFileAsync = promisify(execFile);

/** Docker volume names: start with alphanumeric, then alnum / _ . - */
export const DOCKER_VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

const HELPER_IMAGE = 'alpine';

export function isValidDockerVolumeName(name: string): boolean {
  return DOCKER_VOLUME_NAME_RE.test(name);
}

/** A command is failed on non-zero exit **or** when it was killed by a signal. */
function commandFailed(result: {
  code?: number | null;
  signal?: string | null;
}): boolean {
  if (result.signal) return true;
  return result.code !== 0 && result.code !== null && result.code !== undefined;
}

export function assertValidDockerVolumeName(name: string): void {
  if (!isValidDockerVolumeName(name)) {
    throw new Error(
      `Invalid Docker volume name: ${name}. Names must match ${DOCKER_VOLUME_NAME_RE}`
    );
  }
}

/**
 * Build tar --exclude args. Patterns are passed through shell-quoted.
 */
export function buildTarExcludeArgs(excludePatterns: string[] = []): string {
  return excludePatterns
    .filter(Boolean)
    .map((pattern) => `--exclude=${shellSingleQuote(pattern)}`)
    .join(' ');
}

export function buildPackDockerVolumeCommand(
  volumeName: string,
  remoteTmpDir: string,
  archiveFileName: string,
  excludePatterns: string[] = []
): string {
  assertValidDockerVolumeName(volumeName);
  const excludeArgs = buildTarExcludeArgs(excludePatterns);
  // `docker run -v/--mount` auto-creates a missing named volume, so a renamed
  // or mistyped volume would pack an empty directory and look successful.
  // Re-inspect inside the same shell (defense in depth) and use --mount with
  // volume-nocopy so the helper container never seeds the volume from the image.
  return [
    REMOTE_STANDARD_PATH,
    `docker volume inspect ${shellSingleQuote(volumeName)} >/dev/null`,
    '&&',
    REMOTE_STANDARD_PATH,
    'docker run --rm',
    `--mount ${shellSingleQuote(`type=volume,source=${volumeName},target=/data,volume-nocopy`)}`,
    `-v ${shellSingleQuote(`${remoteTmpDir}:/to`)}`,
    HELPER_IMAGE,
    'tar czf',
    shellSingleQuote(`/to/${archiveFileName}`),
    excludeArgs,
    '-C /data .',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildTarMemberSafetyCheck(archiveInContainer: string): string {
  const quoted = shellSingleQuote(archiveInContainer);
  // Newline-join: the case statements need statement separators (a plain space produces
  // `esac case …`, which is a shell syntax error and broke every volume restore).
  return [
    `tar tzf ${quoted} | while IFS= read -r member || [ -n "$member" ]; do`,
    `  case "$member" in`,
    `    /*) echo "Refusing absolute tar member: $member" >&2; exit 1 ;;`,
    `  esac`,
    `  case "/$member/" in`,
    `    */../*) echo "Refusing tar member path traversal: $member" >&2; exit 1 ;;`,
    `  esac`,
    `done`,
  ].join('\n');
}

/** Alpine-side script for volume restore: member safety check + extract (testable in isolation). */
export function buildDockerVolumeRestoreScript(archiveInContainer: string): string {
  return [
    buildTarMemberSafetyCheck(archiveInContainer),
    '&&',
    'tar_extra=""',
    '&&',
    'if tar --help 2>&1 | grep -q -- --no-absolute-names; then tar_extra=--no-absolute-names; fi',
    '&&',
    `tar xzf ${shellSingleQuote(archiveInContainer)} $tar_extra -C /to`,
  ].join(' ');
}

export function buildRestoreDockerVolumeCommand(
  volumeName: string,
  remoteTarPath: string,
  remoteTmpDir: string
): string {
  assertValidDockerVolumeName(volumeName);
  const archiveName = remoteTarPath.split('/').pop();
  if (!archiveName) {
    throw new Error('Invalid remote tar path');
  }
  const archiveInContainer = `/from/${archiveName}`;
  const safety = buildDockerVolumeRestoreScript(archiveInContainer);
  // BusyBox tar (alpine) strips leading '/' by default and has no --no-absolute-names.
  // GNU tar: add the flag when advertised. Always pre-check members for `..` / absolute names.
  const inner = [
    `docker volume create ${shellSingleQuote(volumeName)} >/dev/null`,
    '&&',
    'docker run --rm',
    `-v ${shellSingleQuote(`${volumeName}:/to`)}`,
    `-v ${shellSingleQuote(`${remoteTmpDir}:/from:ro`)}`,
    HELPER_IMAGE,
    'sh -c',
    shellSingleQuote(safety),
  ].join(' ');

  return `${REMOTE_STANDARD_PATH} sh -c ${shellSingleQuote(inner)}`;
}

export async function assertDockerAvailable(ssh: NodeSSH): Promise<void> {
  const result = await ssh.execCommand(`${REMOTE_STANDARD_PATH} docker info`);
  if (commandFailed(result)) {
    const detail = (result.stderr || result.stdout || 'docker info failed').trim();
    throw new Error(
      `Docker is not available on the remote host (is the daemon running and is this user in the docker group?). ${detail}`
    );
  }
}

const MISSING_VOLUME_RE = /no such volume/i;

function missingVolumeError(volumeName: string, hostLabel: string): Error {
  return new Error(
    `Docker volume "${volumeName}" was not found on ${hostLabel}. Backups are not created for missing volumes.`
  );
}

/**
 * Fail when a named volume is missing. `docker run -v/--mount` auto-creates a
 * named volume, so packing without this check would silently archive an empty
 * directory and report a green (86-byte) backup.
 */
export async function assertDockerVolumeExists(
  ssh: NodeSSH,
  volumeName: string,
  hostLabel = 'the source server'
): Promise<void> {
  assertValidDockerVolumeName(volumeName);
  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} docker volume inspect ${shellSingleQuote(volumeName)}`
  );
  if (!commandFailed(result)) return;

  const detail = (result.stderr || result.stdout || '').trim();
  if (!detail || MISSING_VOLUME_RE.test(detail)) {
    throw missingVolumeError(volumeName, hostLabel);
  }
  throw new Error(`Failed to inspect Docker volume ${volumeName} on ${hostLabel}: ${detail}`);
}

export async function listDockerVolumes(ssh: NodeSSH): Promise<string[]> {
  await assertDockerAvailable(ssh);
  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} docker volume ls --format '{{.Name}}'`
  );
  if (commandFailed(result)) {
    const detail = (result.stderr || result.stdout || 'docker volume ls failed').trim();
    throw new Error(`Failed to list Docker volumes: ${detail}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export type PackDockerVolumeResult = {
  remoteArchivePath: string;
  remoteTmpDir: string;
  stdout: string;
  stderr: string;
};

/**
 * Create a remote temp dir, pack the volume into a .tar.gz via alpine helper, return paths.
 * Caller must clean up remoteTmpDir.
 */
export async function packDockerVolume(
  ssh: NodeSSH,
  volumeName: string,
  excludePatterns: string[] = [],
  hostLabel = 'the source server'
): Promise<PackDockerVolumeResult> {
  assertValidDockerVolumeName(volumeName);
  await assertDockerAvailable(ssh);
  await assertDockerVolumeExists(ssh, volumeName, hostLabel);

  const mktemp = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} mktemp -d /tmp/lazybackup-docker-XXXXXX`
  );
  if ((mktemp.code !== 0 && mktemp.code !== null && mktemp.code !== undefined) || !mktemp.stdout.trim()) {
    throw new Error(`Failed to create remote temp directory: ${mktemp.stderr || mktemp.stdout}`);
  }
  const remoteTmpDir = mktemp.stdout.trim();
  const archiveFileName = `${volumeName}.tar.gz`;
  const remoteArchivePath = `${remoteTmpDir}/${archiveFileName}`;

  const packCmd = buildPackDockerVolumeCommand(
    volumeName,
    remoteTmpDir,
    archiveFileName,
    excludePatterns
  );
  const packResult = await ssh.execCommand(packCmd);
  if (commandFailed(packResult)) {
    await ssh.execCommand(`rm -rf ${shellSingleQuote(remoteTmpDir)}`).catch(() => {});
    throw new Error(
      `Failed to pack Docker volume ${volumeName}: ${(packResult.stderr || packResult.stdout).trim()}`
    );
  }

  return {
    remoteArchivePath,
    remoteTmpDir,
    stdout: packResult.stdout,
    stderr: packResult.stderr,
  };
}

export type RestoreDockerVolumeResult = {
  stdout: string;
  stderr: string;
  remoteTmpDir: string;
};

/**
 * Extract a remote .tar.gz into a Docker volume (creates volume if missing).
 * Caller should remove remoteTmpDir after transfer cleanup.
 */
export async function restoreDockerVolume(
  ssh: NodeSSH,
  volumeName: string,
  remoteTarPath: string,
  remoteTmpDir: string
): Promise<RestoreDockerVolumeResult> {
  assertValidDockerVolumeName(volumeName);
  await assertDockerAvailable(ssh);

  const restoreCmd = buildRestoreDockerVolumeCommand(volumeName, remoteTarPath, remoteTmpDir);
  const result = await ssh.execCommand(restoreCmd);
  if (commandFailed(result)) {
    throw new Error(
      `Failed to restore Docker volume ${volumeName}: ${(result.stderr || result.stdout).trim()}`
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    remoteTmpDir,
  };
}

export async function cleanupRemoteDir(ssh: NodeSSH, remoteDir: string): Promise<void> {
  if (!remoteDir.startsWith('/tmp/lazybackup-')) {
    throw new Error(`Refusing to delete unexpected remote path: ${remoteDir}`);
  }
  await ssh.execCommand(`rm -rf ${shellSingleQuote(remoteDir)}`);
}

export async function checkRemoteDockerAvailable(ssh: NodeSSH): Promise<boolean> {
  try {
    await assertDockerAvailable(ssh);
    return true;
  } catch {
    return false;
  }
}

export type DockerShellRunner = (command: string) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
}>;

export async function execLocalSh(command: string): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || e.message || 'command failed'),
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

/**
 * Shell output meaning the Docker CLI binary itself is missing (the official
 * Alpine image ships no docker client), as opposed to a CLI that cannot reach
 * the daemon. Must not match daemon / permission errors.
 */
const DOCKER_CLI_MISSING_RE =
  /(?:^|[\s:])"?docker"?:\s*(?:command\s+)?not\s+found|exec:\s*"?docker"?:\s*executable file not found in \$?\{?PATH\}?/i;

export function isDockerCliMissing(detail: string): boolean {
  return DOCKER_CLI_MISSING_RE.test(detail);
}

export type DockerUnavailableCode = 'docker_cli_missing' | 'docker_unreachable';

export class DockerUnavailableError extends Error {
  readonly code: DockerUnavailableCode;
  name = 'DockerUnavailableError';

  constructor(message: string, code: DockerUnavailableCode) {
    super(message);
    this.code = code;
  }
}

const DOCKER_CLI_MISSING_MESSAGE =
  'The Docker CLI is not installed in this environment, so LazyBackup cannot list or pack Docker volumes on this host. Local Docker-volume backups and docker exec database dumps need the Docker CLI plus /var/run/docker.sock, and the official image ships neither. Add this host as a Server over SSH instead, or run LazyBackup natively with Docker installed.';

export async function assertLocalDockerAvailable(
  runShell: DockerShellRunner = execLocalSh
): Promise<void> {
  const result = await runShell(`${REMOTE_STANDARD_PATH} docker info`);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || 'docker info failed').trim();
    if (isDockerCliMissing(detail)) {
      throw new DockerUnavailableError(DOCKER_CLI_MISSING_MESSAGE, 'docker_cli_missing');
    }
    throw new DockerUnavailableError(
      `Docker is not reachable on this host (is the daemon running and is this process allowed to use the socket?). ${detail}`,
      'docker_unreachable'
    );
  }
}

/** Local mirror of `assertDockerVolumeExists` (same auto-create hazard). */
export async function assertLocalDockerVolumeExists(
  volumeName: string,
  hostLabel = 'this host',
  runShell: DockerShellRunner = execLocalSh
): Promise<void> {
  assertValidDockerVolumeName(volumeName);
  const result = await runShell(
    `${REMOTE_STANDARD_PATH} docker volume inspect ${shellSingleQuote(volumeName)}`
  );
  if (result.code === 0) return;

  const detail = (result.stderr || result.stdout || '').trim();
  if (!detail || MISSING_VOLUME_RE.test(detail)) {
    throw missingVolumeError(volumeName, hostLabel);
  }
  throw new Error(`Failed to inspect Docker volume ${volumeName} on ${hostLabel}: ${detail}`);
}

export async function checkLocalDockerAvailable(): Promise<boolean> {
  try {
    await assertLocalDockerAvailable();
    return true;
  } catch {
    return false;
  }
}

function parseDockerNameList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function listLocalDockerVolumes(): Promise<string[]> {
  await assertLocalDockerAvailable();
  const result = await execLocalSh(
    `${REMOTE_STANDARD_PATH} docker volume ls --format '{{.Name}}'`
  );
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || 'docker volume ls failed').trim();
    throw new Error(`Failed to list Docker volumes: ${detail}`);
  }
  return parseDockerNameList(result.stdout);
}

export type PackLocalDockerVolumeResult = {
  localArchivePath: string;
  localTmpDir: string;
  stdout: string;
  stderr: string;
};

/** Pack a named volume on this host via alpine helper (`sh -c` of the remote command). */
export async function packDockerVolumeLocal(
  volumeName: string,
  excludePatterns: string[] = [],
  runShell: DockerShellRunner = execLocalSh
): Promise<PackLocalDockerVolumeResult> {
  assertValidDockerVolumeName(volumeName);
  await assertLocalDockerAvailable(runShell);
  await assertLocalDockerVolumeExists(volumeName, 'this host', runShell);

  const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-docker-'));
  const archiveFileName = `${volumeName}.tar.gz`;
  const packCmd = buildPackDockerVolumeCommand(
    volumeName,
    localTmpDir,
    archiveFileName,
    excludePatterns
  );
  const packResult = await runShell(packCmd);
  if (packResult.code !== 0) {
    await fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to pack Docker volume ${volumeName}: ${(packResult.stderr || packResult.stdout).trim()}`
    );
  }

  return {
    localArchivePath: path.join(localTmpDir, archiveFileName),
    localTmpDir,
    stdout: packResult.stdout,
    stderr: packResult.stderr,
  };
}

export async function restoreDockerVolumeLocal(
  volumeName: string,
  localTarPath: string
): Promise<{ stdout: string; stderr: string; localTmpDir: string }> {
  assertValidDockerVolumeName(volumeName);
  await assertLocalDockerAvailable();

  const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-docker-'));
  const archiveName = path.basename(localTarPath);
  const destTar = path.join(localTmpDir, archiveName);
  await fs.copyFile(localTarPath, destTar);

  const restoreCmd = buildRestoreDockerVolumeCommand(volumeName, destTar, localTmpDir);
  const result = await execLocalSh(restoreCmd);
  if (result.code !== 0) {
    await fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to restore Docker volume ${volumeName}: ${(result.stderr || result.stdout).trim()}`
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    localTmpDir,
  };
}

export async function cleanupLocalDockerTmpDir(localDir: string): Promise<void> {
  const resolved = path.resolve(localDir);
  const tmpRoot = path.resolve(os.tmpdir());
  if (
    !resolved.startsWith(tmpRoot + path.sep) ||
    !path.basename(resolved).startsWith('lazybackup-docker-')
  ) {
    throw new Error(`Refusing to delete unexpected local path: ${localDir}`);
  }
  await fs.rm(resolved, { recursive: true, force: true });
}
