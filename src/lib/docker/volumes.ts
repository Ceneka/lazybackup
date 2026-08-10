import { shellSingleQuote } from '@/lib/ssh/rsync';
import type { NodeSSH } from 'node-ssh';

/** Docker volume names: start with alphanumeric, then alnum / _ . - */
export const DOCKER_VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

const HELPER_IMAGE = 'alpine';

export function isValidDockerVolumeName(name: string): boolean {
  return DOCKER_VOLUME_NAME_RE.test(name);
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
  return [
    REMOTE_STANDARD_PATH,
    'docker run --rm',
    `-v ${shellSingleQuote(`${volumeName}:/from:ro`)}`,
    `-v ${shellSingleQuote(`${remoteTmpDir}:/to`)}`,
    HELPER_IMAGE,
    'tar czf',
    shellSingleQuote(`/to/${archiveFileName}`),
    excludeArgs,
    '-C /from .',
  ]
    .filter(Boolean)
    .join(' ');
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
  const inner = [
    `docker volume create ${shellSingleQuote(volumeName)} >/dev/null`,
    '&&',
    'docker run --rm',
    `-v ${shellSingleQuote(`${volumeName}:/to`)}`,
    `-v ${shellSingleQuote(`${remoteTmpDir}:/from:ro`)}`,
    HELPER_IMAGE,
    'tar xzf',
    shellSingleQuote(`/from/${archiveName}`),
    '-C /to',
  ].join(' ');

  return `${REMOTE_STANDARD_PATH} sh -c ${shellSingleQuote(inner)}`;
}

export async function assertDockerAvailable(ssh: NodeSSH): Promise<void> {
  const result = await ssh.execCommand(`${REMOTE_STANDARD_PATH} docker info`);
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    const detail = (result.stderr || result.stdout || 'docker info failed').trim();
    throw new Error(
      `Docker is not available on the remote host (is the daemon running and is this user in the docker group?). ${detail}`
    );
  }
}

export async function listDockerVolumes(ssh: NodeSSH): Promise<string[]> {
  await assertDockerAvailable(ssh);
  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} docker volume ls --format '{{.Name}}'`
  );
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
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
  excludePatterns: string[] = []
): Promise<PackDockerVolumeResult> {
  assertValidDockerVolumeName(volumeName);
  await assertDockerAvailable(ssh);

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
  if (packResult.code !== 0 && packResult.code !== null && packResult.code !== undefined) {
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
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
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
