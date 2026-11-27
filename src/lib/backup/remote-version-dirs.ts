import { ensureRemoteDirectory } from '@/lib/ssh/ephemeral';
import { remotePathShellWord } from '@/lib/ssh/rsync';
import type { NodeSSH } from 'node-ssh';
import {
  formatVersionDirName,
  parseVersionDirName,
  selectVersionDirNamesToDelete,
} from './version-dirs';

const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

export type RemoteShell = {
  execCommand(command: string): Promise<{
    code?: number | null;
    signal?: string | null;
    stdout: string;
    stderr: string;
  }>;
};

/**
 * Pick a free remote version directory (rare same-second collision).
 *
 * Uses remotePathShellWord so a destination like `~/backups` means the remote
 * $HOME, exactly as rsync/scp interpret it. A single-quoted `~/...` would
 * create (or look for) a literal `~` directory instead.
 */
export async function createUniqueRemoteVersionDir(
  ssh: RemoteShell,
  baseDir: string,
  timestamp: string
): Promise<string> {
  const base = baseDir.replace(/\/+$/, '') || '/';
  await ensureRemoteDirectory(ssh as unknown as NodeSSH, base);

  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const candidate = `${base}/${formatVersionDirName(timestamp, ordinal)}`;
    const result = await ssh.execCommand(
      `${REMOTE_STANDARD_PATH} mkdir -- ${remotePathShellWord(candidate)}`
    );
    if (result.code === 0) return candidate;
    const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
    if (output.includes('file exists')) continue;
    throw new Error(
      `Failed to create remote version directory ${candidate}: ${result.stderr || result.stdout}`
    );
  }

  throw new Error(`Could not allocate a unique remote version directory for ${timestamp}`);
}

/** Delete remote version dirs beyond `keep`; returns deleted absolute paths. */
export async function cleanupRemoteVersionDirs(
  ssh: RemoteShell,
  baseDir: string,
  versionsToKeep: number,
  protectedNames: Iterable<string> = []
): Promise<string[]> {
  const list = await ssh.execCommand(
    `${REMOTE_STANDARD_PATH} ls -1 -- ${remotePathShellWord(baseDir)} 2>/dev/null || true`
  );
  const names = (list.stdout || '')
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => parseVersionDirName(name) !== null);
  const toDelete = selectVersionDirNamesToDelete(
    names,
    versionsToKeep,
    protectedNames
  );

  const deleted: string[] = [];
  for (const name of toDelete) {
    const full = `${baseDir.replace(/\/+$/, '')}/${name}`;
    console.log(`Deleting old remote backup version: ${full}`);
    const removed = await ssh.execCommand(
      `${REMOTE_STANDARD_PATH} rm -rf -- ${remotePathShellWord(full)}`
    );
    // Do not flag history as removed when the delete did not actually happen.
    if (
      removed.signal ||
      (removed.code !== 0 && removed.code !== null && removed.code !== undefined)
    ) {
      console.warn(
        `Failed to delete old remote backup version ${full}: ${removed.stderr || removed.stdout}`
      );
      continue;
    }
    deleted.push(full);
  }
  return deleted;
}
