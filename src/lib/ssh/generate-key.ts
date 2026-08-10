import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { shellSingleQuote } from './rsync';

const execFileAsync = promisify(execFile);

/**
 * One-liner to paste on a remote host (as the SSH user) so LazyBackup can connect
 * with the matching private key. Idempotent if the key is already present.
 */
export function buildAuthorizedKeysInstallCommand(publicKey: string): string {
  const pub = publicKey.trim().replace(/\s+/g, ' ');
  if (!pub) {
    throw new Error('Public key is required');
  }
  const quoted = shellSingleQuote(pub);
  return [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    `(grep -qxF ${quoted} ~/.ssh/authorized_keys || echo ${quoted} >> ~/.ssh/authorized_keys)`,
  ].join(' && ');
}

/** Generate an Ed25519 key pair via ssh-keygen (openssh-client). */
export async function generateStoredEd25519KeyPair(
  comment = 'lazybackup'
): Promise<{ privateKey: string; publicKey: string }> {
  const id = randomBytes(8).toString('hex');
  const privateKeyPath = path.join(tmpdir(), `lazybackup-gen-${id}`);
  const publicKeyPath = `${privateKeyPath}.pub`;

  try {
    await execFileAsync('ssh-keygen', [
      '-t',
      'ed25519',
      '-f',
      privateKeyPath,
      '-N',
      '',
      '-C',
      comment,
      '-q',
    ]);
    await fs.chmod(privateKeyPath, 0o600);

    const privateKey = await fs.readFile(privateKeyPath, 'utf8');
    const publicKey = (await fs.readFile(publicKeyPath, 'utf8')).trim();
    return { privateKey, publicKey };
  } finally {
    await fs.unlink(privateKeyPath).catch(() => {});
    await fs.unlink(publicKeyPath).catch(() => {});
  }
}

/** Derive the OpenSSH public key line from private key PEM/OpenSSH content. */
export async function derivePublicKeyFromPrivate(privateKey: string): Promise<string> {
  const trimmed = privateKey.trim();
  if (!trimmed) {
    throw new Error('Private key is required');
  }

  const id = randomBytes(8).toString('hex');
  const privateKeyPath = path.join(tmpdir(), `lazybackup-pub-${id}`);

  try {
    await fs.writeFile(privateKeyPath, `${trimmed}\n`, { mode: 0o600 });
    const { stdout } = await execFileAsync('ssh-keygen', ['-y', '-f', privateKeyPath]);
    return stdout.trim();
  } finally {
    await fs.unlink(privateKeyPath).catch(() => {});
  }
}
