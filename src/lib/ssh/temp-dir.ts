import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Mode-0700 directory for temporary SSH identities.
 * SSH_KEYS_PATH is often bind-mounted read-only in Docker, so we fall back
 * to os.tmpdir()/lazybackup-ssh.
 */
export async function ensureSshTempDir(): Promise<string> {
  const candidates: string[] = [];
  const sshKeys = process.env.SSH_KEYS_PATH?.trim();
  if (sshKeys) {
    const expanded = sshKeys.startsWith('~')
      ? sshKeys.replace(/^~(?=\/|$)/, process.env.HOME || '')
      : sshKeys;
    if (expanded) {
      candidates.push(path.join(path.resolve(expanded), 'lazybackup-tmp'));
    }
  }
  candidates.push(path.join(tmpdir(), 'lazybackup-ssh'));

  let lastError: unknown;
  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.chmod(dir, 0o700);
      const probe = path.join(dir, `.w-${process.pid}`);
      await fs.writeFile(probe, '', { mode: 0o600 });
      await fs.unlink(probe);
      return dir;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Cannot create a mode-0700 SSH temp directory: ${
      lastError instanceof Error ? lastError.message : 'permission denied'
    }`
  );
}

export async function mkdtempSsh(prefix: string): Promise<string> {
  const base = await ensureSshTempDir();
  return fs.mkdtemp(path.join(base, prefix), { encoding: 'utf8' });
}
