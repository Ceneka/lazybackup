import { execFileSync } from 'child_process';
import { promises as fs, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { z } from 'zod';
import { resolveSystemKeyPath } from '@/lib/ssh';

/**
 * Write-time validation for SSH credential material.
 *
 * These helpers parse the exact private key node-ssh will use, so routes can
 * reject unusable credentials with a 400 field error instead of storing them
 * and failing later inside a backup run.
 */

export type KeyValidationResult = { ok: true } | { ok: false; message: string };

export const SSH_PORT_MIN = 1;
export const SSH_PORT_MAX = 65535;
const PORT_MESSAGE = `Port must be between ${SSH_PORT_MIN} and ${SSH_PORT_MAX}`;

/** Shared server create/update payload shape (POST and PUT use identical fields). */
export const serverInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  host: z.string().min(1, 'Host is required'),
  port: z
    .number()
    .int()
    .min(SSH_PORT_MIN, PORT_MESSAGE)
    .max(SSH_PORT_MAX, PORT_MESSAGE)
    .default(22),
  username: z.string().min(1, 'Username is required'),
  authType: z.enum(['password', 'key']),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  sshKeyId: z.string().nullish(),
  systemKeyPath: z.string().nullish(),
});

export type ServerInput = z.infer<typeof serverInputSchema>;

export type ServerCredentialField =
  | 'password'
  | 'privateKey'
  | 'sshKeyId'
  | 'systemKeyPath';

export type ServerCredentialCheck =
  | { ok: true }
  | { ok: false; field: ServerCredentialField; message: string };

const PASSPHRASE_MESSAGE =
  'Private key is passphrase-protected. LazyBackup cannot use a key that needs a passphrase — provide an unencrypted key.';
const PUBLIC_KEY_MESSAGE =
  'This is a public key, not a private key. Paste the matching private key instead.';

/** A private key is a few KiB; anything much larger is not key material. */
const MAX_PRIVATE_KEY_BYTES = 128 * 1024;
const SSH_KEYGEN_TIMEOUT_MS = 5_000;

type ParseKeyFn = (data: string | Buffer) => unknown;

let cachedParseKey: ParseKeyFn | null | undefined;

/**
 * `ssh2.utils.parseKey` (ssh2 ships with node-ssh and Next keeps it external).
 * Resolved lazily so an install without the module falls back to ssh-keygen
 * instead of breaking the route import.
 */
function getParseKey(): ParseKeyFn | null {
  if (cachedParseKey !== undefined) {
    return cachedParseKey;
  }
  try {
    const ssh2 = require('ssh2') as { utils?: { parseKey?: ParseKeyFn } };
    cachedParseKey =
      typeof ssh2.utils?.parseKey === 'function' ? ssh2.utils.parseKey : null;
  } catch {
    cachedParseKey = null;
  }
  return cachedParseKey;
}

/** Accept keys stored with literal `\n` escapes or CRLF line endings. */
function normalizeKeyText(content: string | null | undefined): string {
  let text = (content ?? '').trim();
  if (text.includes('-----BEGIN') && text.includes('\\n') && !text.includes('\n')) {
    text = text.replace(/\\n/g, '\n');
  }
  return text.replace(/\r\n?/g, '\n').trim();
}

function describeParseError(message: string): string {
  if (/encrypt|passphrase/i.test(message)) {
    return PASSPHRASE_MESSAGE;
  }
  return `Private key is not valid: ${message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isParsedPrivateKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const key = value as { type?: unknown; isPrivateKey?: () => boolean };
  if (typeof key.type !== 'string') {
    return false;
  }
  return typeof key.isPrivateKey === 'function' ? key.isPrivateKey() : true;
}

/**
 * Parse PGP/OpenSSH/PEM private key content without touching disk.
 * Returns `ok: false` with a human-readable reason when the key is unusable.
 */
export function validatePrivateKeyMaterial(
  content: string
): KeyValidationResult {
  const text = normalizeKeyText(content);
  if (!text) {
    return { ok: false, message: 'Private key is empty' };
  }
  if (text.length > MAX_PRIVATE_KEY_BYTES) {
    return {
      ok: false,
      message: 'Private key is too large to be a valid SSH key',
    };
  }

  const parseKey = getParseKey();
  if (!parseKey) {
    return validateWithSshKeygen(text);
  }

  let parsed: unknown;
  try {
    parsed = parseKey(text);
  } catch (error) {
    return { ok: false, message: `Private key is not valid: ${errorMessage(error)}` };
  }

  if (parsed instanceof Error) {
    return { ok: false, message: describeParseError(parsed.message) };
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) {
    return { ok: false, message: 'Private key is not valid: no keys found' };
  }

  const hasPrivateKey = entries.some(isParsedPrivateKey);
  if (!hasPrivateKey) {
    return { ok: false, message: PUBLIC_KEY_MESSAGE };
  }
  return { ok: true };
}

/**
 * Validate a key file on this host: it must exist, be readable, and parse.
 * Mirrors how backups read `systemKeyPath` / `ssh_keys.privateKeyPath`.
 */
export async function validatePrivateKeyPath(
  keyPath: string
): Promise<KeyValidationResult> {
  const target = (keyPath ?? '').trim();
  if (!target) {
    return { ok: false, message: 'Private key path is required' };
  }
  // Same expansion node-ssh gets at connect time, so `~/.ssh/id_ed25519`
  // validates instead of failing on a literal `~` directory.
  const resolved = resolveSystemKeyPath(target);

  let content: string;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return {
        ok: false,
        message: `Private key path is not a file: ${target}`,
      };
    }
    content = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, message: `Private key file not found: ${target}` };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        message: `Private key file is not readable: ${target}`,
      };
    }
    return {
      ok: false,
      message: `Could not read private key file ${target}: ${errorMessage(error)}`,
    };
  }

  const result = validatePrivateKeyMaterial(content);
  if (!result.ok) {
    return { ok: false, message: `Private key file ${target}: ${result.message}` };
  }
  return { ok: true };
}

/** Validate a stored `ssh_keys` row: inline content wins over a file path. */
export async function validateSshKeyMaterial(key: {
  privateKeyContent?: string | null;
  privateKeyPath?: string | null;
}): Promise<KeyValidationResult> {
  if (key.privateKeyContent?.trim()) {
    return validatePrivateKeyMaterial(key.privateKeyContent);
  }
  if (key.privateKeyPath?.trim()) {
    return validatePrivateKeyPath(key.privateKeyPath);
  }
  return {
    ok: false,
    message: 'SSH key has no private key content or path',
  };
}

/**
 * Check the effective server credentials (after `PUT` keeps stored secrets for
 * blank fields). The stored `sshKeyId` row is checked separately by the routes
 * because it needs a database lookup.
 */
export async function validateServerCredentials(input: {
  authType: 'password' | 'key';
  password?: string | null;
  privateKey?: string | null;
  sshKeyId?: string | null;
  systemKeyPath?: string | null;
}): Promise<ServerCredentialCheck> {
  if (input.authType === 'password') {
    if (!input.password?.trim()) {
      return {
        ok: false,
        field: 'password',
        message: 'Password is required for password authentication',
      };
    }
    return { ok: true };
  }

  const privateKey = input.privateKey?.trim() ?? '';
  const sshKeyId = input.sshKeyId?.trim() ?? '';
  const systemKeyPath = input.systemKeyPath?.trim() ?? '';

  if (!privateKey && !sshKeyId && !systemKeyPath) {
    return {
      ok: false,
      field: 'privateKey',
      message:
        'When using key authentication, you must provide a private key, select a stored key, or specify a system key path',
    };
  }

  if (privateKey) {
    const result = validatePrivateKeyMaterial(privateKey);
    if (!result.ok) {
      return { ok: false, field: 'privateKey', message: result.message };
    }
  }

  if (systemKeyPath) {
    const result = await validatePrivateKeyPath(systemKeyPath);
    if (!result.ok) {
      return { ok: false, field: 'systemKeyPath', message: result.message };
    }
  }

  return { ok: true };
}

/**
 * Fallback when ssh2's parser is unavailable: `ssh-keygen -y -f` accepts the
 * key only when it can derive the public key (no passphrase prompt in `-P ''`
 * mode; encrypted keys fail fast).
 */
function validateWithSshKeygen(text: string): KeyValidationResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazybackup-key-check-'));
  const keyPath = path.join(dir, 'key');
  try {
    writeFileSync(keyPath, `${text}\n`, { mode: 0o600 });
    execFileSync('ssh-keygen', ['-y', '-f', keyPath], {
      timeout: SSH_KEYGEN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (error) {
    const err = error as { stderr?: Buffer | string; code?: string };
    const stderr =
      typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr?.toString('utf8') ?? '';
    const combined = `${stderr} ${errorMessage(error)}`;
    if (/encrypt|passphrase/i.test(combined)) {
      return { ok: false, message: PASSPHRASE_MESSAGE };
    }
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        message:
          'Cannot validate private key: the ssh2 key parser and ssh-keygen are both unavailable',
      };
    }
    return {
      ok: false,
      message: 'Private key is not valid: ssh-keygen could not read it',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
