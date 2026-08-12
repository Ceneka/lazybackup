import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { NodeSSH } from 'node-ssh';
import { isBackupArtifactFileName } from '@/lib/backup/file-retention';
import { assertSafePathString } from '@/lib/backup/local-paths';
import { ensureKnownHostsFile, sshStrictHostKeyCliOptions } from './known-hosts';
import { shellSingleQuote, sshUserHost, assertSshPort, assertSafeCliToken } from './rsync';
import { ensureSshTempDir } from './temp-dir';

const execFileAsync = promisify(execFile);

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

/** Marker prefix embedded in authorized_keys comments for reliable cleanup. */
export const EPHEMERAL_KEY_MARKER_PREFIX = 'lazybackup-ephemeral:';

export function buildEphemeralKeyMarker(id?: string): string {
  return `${EPHEMERAL_KEY_MARKER_PREFIX}${id || randomBytes(8).toString('hex')}`;
}

/** Pure helper: build the authorized_keys line we install on the destination. */
export function buildAuthorizedKeysEntry(marker: string, publicKey: string): string {
  const pub = publicKey.trim().replace(/\s+/g, ' ');
  return `${pub} ${marker}`;
}

/**
 * Pure helper: remove lines containing the marker from authorized_keys text.
 * Used by unit tests and as the conceptual model for the remote sed command.
 */
export function stripAuthorizedKeysMarker(authorizedKeysContent: string, marker: string): string {
  const lines = authorizedKeysContent.split(/\r?\n/);
  const kept = lines.filter((line) => !line.includes(marker));
  return kept.join('\n').replace(/\n+$/, '') + (kept.length ? '\n' : '');
}

/** Remote shell snippet that deletes marked lines from ~/.ssh/authorized_keys. */
export function buildRemoveAuthorizedKeysCommand(marker: string): string {
  const escaped = marker.replace(/[\\/&]/g, '\\$&');
  return `${REMOTE_STANDARD_PATH} mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && sed -i '/${escaped}/d' ~/.ssh/authorized_keys`;
}

export async function generateEphemeralEd25519KeyPair(): Promise<{
  marker: string;
  privateKeyPath: string;
  publicKey: string;
  cleanup: () => Promise<void>;
}> {
  const marker = buildEphemeralKeyMarker();
  const dir = await ensureSshTempDir();
  const id = randomBytes(8).toString('hex');
  const privateKeyPath = path.join(dir, `eph-${id}`);
  const publicKeyPath = `${privateKeyPath}.pub`;

  await execFileAsync('ssh-keygen', [
    '-t',
    'ed25519',
    '-f',
    privateKeyPath,
    '-N',
    '',
    '-C',
    marker,
    '-q',
  ]);
  await fs.chmod(privateKeyPath, 0o600);

  const publicKey = (await fs.readFile(publicKeyPath, 'utf8')).trim();

  return {
    marker,
    privateKeyPath,
    publicKey,
    cleanup: async () => {
      await fs.unlink(privateKeyPath).catch(() => {});
      await fs.unlink(publicKeyPath).catch(() => {});
    },
  };
}

export async function installEphemeralAuthorizedKey(
  destSsh: NodeSSH,
  marker: string,
  publicKey: string
): Promise<void> {
  const entry = buildAuthorizedKeysEntry(marker, publicKey);
  const quoted = shellSingleQuote(entry);
  const result = await destSsh.execCommand(
    `${REMOTE_STANDARD_PATH} mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo ${quoted} >> ~/.ssh/authorized_keys`
  );
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    throw new Error(`Failed to install ephemeral SSH key on destination: ${result.stderr || result.stdout}`);
  }
}

export async function removeEphemeralAuthorizedKey(destSsh: NodeSSH, marker: string): Promise<void> {
  const result = await destSsh.execCommand(buildRemoveAuthorizedKeysCommand(marker));
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    console.warn(`Failed to remove ephemeral SSH key from destination: ${result.stderr || result.stdout}`);
  }
}

/**
 * Probe whether the source host can open a TCP connection to dest host:port.
 */
export async function probeSourceCanReachDest(
  sourceSsh: NodeSSH,
  destHost: string,
  destPort: number,
  timeoutSeconds = 5
): Promise<boolean> {
  const hostQ = shellSingleQuote(destHost);
  const cmd = `${REMOTE_STANDARD_PATH} (command -v nc >/dev/null 2>&1 && nc -z -w ${timeoutSeconds} ${hostQ} ${destPort}) || (command -v timeout >/dev/null 2>&1 && timeout ${timeoutSeconds} bash -c 'echo >/dev/tcp/${destHost.replace(/'/g, '')}/${destPort}') || false`;
  const result = await sourceSsh.execCommand(cmd);
  return result.code === 0 || result.code === null;
}

/**
 * Copy ephemeral private key to source, run rsync from source → dest, then remove key from source.
 */
export async function runEphemeralDirectRsync(options: {
  sourceSsh: NodeSSH;
  sourcePath: string;
  destUsername: string;
  destHost: string;
  destPort: number;
  destPath: string;
  ephemeralPrivateKeyPath: string;
  excludePatterns?: string[];
}): Promise<{ stdout: string; stderr: string }> {
  const destPort = assertSshPort(options.destPort);
  assertSafeCliToken(options.sourcePath, 'Source path');
  assertSafeCliToken(options.destPath, 'Destination path');
  const destUserHost = sshUserHost(options.destUsername, options.destHost);
  const remoteKeyPath = `/tmp/lazybackup-eph-${randomBytes(8).toString('hex')}`;
  const knownHostsPath = await ensureKnownHostsFile();
  const remoteKnownHosts = `/tmp/lazybackup-known-hosts-${randomBytes(8).toString('hex')}`;

  try {
    await options.sourceSsh.putFile(options.ephemeralPrivateKeyPath, remoteKeyPath);
    await options.sourceSsh.execCommand(`chmod 600 ${shellSingleQuote(remoteKeyPath)}`);
    await options.sourceSsh.putFile(knownHostsPath, remoteKnownHosts);
    await options.sourceSsh.execCommand(`chmod 600 ${shellSingleQuote(remoteKnownHosts)}`);

    const excludeArgs = (options.excludePatterns || [])
      .map((pattern) => {
        assertSafePathString(pattern, 'Exclude pattern');
        return `--exclude=${shellSingleQuote(pattern)}`;
      })
      .join(' ');

    const sourceArg = options.sourcePath.endsWith('/')
      ? options.sourcePath
      : `${options.sourcePath}/`;
    const destArg = `${destUserHost}:${options.destPath}`;

    const sshOptParts: string[] = [
      '-p',
      String(destPort),
      '-i',
      remoteKeyPath,
      '-F',
      '/dev/null',
      ...sshStrictHostKeyCliOptions(remoteKnownHosts),
    ];
    const sshOptsQuoted = sshOptParts
      .map((part) => (part.startsWith('-') && !part.includes('=') ? part : shellSingleQuote(part)))
      .join(' ');
    const rsyncCmd = `${REMOTE_STANDARD_PATH} rsync -avz --stats --safe-links ${excludeArgs} -e ${shellSingleQuote(`ssh ${sshOptsQuoted}`)} ${shellSingleQuote(sourceArg)} ${shellSingleQuote(destArg)}`;

    const result = await options.sourceSsh.execCommand(rsyncCmd);
    if (result.code !== 0 && result.code !== null && result.code !== undefined) {
      throw new Error(
        `Ephemeral server-to-server rsync failed: ${result.stderr || result.stdout || `exit ${result.code}`}`
      );
    }

    return { stdout: result.stdout || '', stderr: result.stderr || '' };
  } finally {
    await options.sourceSsh
      .execCommand(
        `rm -f ${shellSingleQuote(remoteKeyPath)} ${shellSingleQuote(remoteKnownHosts)}`
      )
      .catch(() => {});
  }
}

/**
 * Ensure a remote directory exists (for versioned destinations).
 */
export async function ensureRemoteDirectory(ssh: NodeSSH, remotePath: string): Promise<void> {
  const result = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} mkdir -p ${shellSingleQuote(remotePath)}`
  );
  if (result.code !== 0 && result.code !== null && result.code !== undefined) {
    throw new Error(`Failed to create remote directory ${remotePath}: ${result.stderr || result.stdout}`);
  }
}

/**
 * List remote version directories (YYYY-MM-DD_HH-mm-ss) and delete oldest beyond keep count.
 */
export async function cleanupRemoteOldVersions(
  ssh: NodeSSH,
  baseDir: string,
  versionsToKeep: number
): Promise<void> {
  const list = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} ls -1 ${shellSingleQuote(baseDir)} 2>/dev/null || true`
  );
  const dirs = (list.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse();

  if (dirs.length <= versionsToKeep) {
    return;
  }

  for (const dir of dirs.slice(versionsToKeep)) {
    const full = `${baseDir.replace(/\/+$/, '')}/${dir}`;
    console.log(`Deleting old remote backup version: ${full}`);
    await ssh.execCommand(`${REMOTE_STANDARD_PATH} rm -rf ${shellSingleQuote(full)}`);
  }
}

/**
 * Age-based file retention on a remote destination directory.
 */
export async function cleanupRemoteOldFiles(
  ssh: NodeSSH,
  destinationPath: string,
  maxAge: number,
  unit: 'days' | 'months',
  minKeep: number
): Promise<string[]> {
  // List top-level files with mtime epoch seconds
  const list = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} find ${shellSingleQuote(destinationPath)} -maxdepth 1 -type f -printf '%T@ %f\\n' 2>/dev/null || true`
  );
  const files: { name: string; mtimeMs: number }[] = [];
  for (const line of (list.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    if (space <= 0) continue;
    const epoch = Number(trimmed.slice(0, space));
    const name = trimmed.slice(space + 1);
    if (!name || Number.isNaN(epoch)) continue;
    files.push({ name, mtimeMs: epoch * 1000 });
  }

  const { selectFilesToDelete } = await import('@/lib/backup/file-retention');
  const artifacts = files.filter((file) => isBackupArtifactFileName(file.name));
  const toDelete = selectFilesToDelete(artifacts, {
    maxAge,
    unit,
    minKeep,
  });

  for (const name of toDelete) {
    const full = `${destinationPath.replace(/\/+$/, '')}/${name}`;
    console.log(`Deleting old remote backup file (retention): ${name}`);
    await ssh.execCommand(`${REMOTE_STANDARD_PATH} rm -f ${shellSingleQuote(full)}`);
  }

  return toDelete;
}
