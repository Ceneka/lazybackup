import { promises as fs } from 'fs';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

/** OpenSSH known_hosts host field: `name` or `[name]:port` when port !== 22. */
export function knownHostsHostField(host: string, port: number): string {
  const safeHost = host.trim();
  if (!safeHost || /[\r\n\s,]/.test(safeHost)) {
    throw new Error('Invalid SSH host');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid SSH port');
  }
  return port === 22 ? safeHost : `[${safeHost}]:${port}`;
}

export function parseSshPublicKeyBuffer(key: Buffer): { type: string; base64: string } {
  if (key.length < 8) {
    throw new Error('Invalid SSH host key');
  }
  const typeLen = key.readUInt32BE(0);
  if (typeLen < 1 || typeLen > 64 || 4 + typeLen > key.length) {
    throw new Error('Invalid SSH host key');
  }
  const type = key.subarray(4, 4 + typeLen).toString('ascii');
  if (!/^[\w.-]+$/.test(type)) {
    throw new Error('Invalid SSH host key type');
  }
  return { type, base64: key.toString('base64') };
}

export function formatKnownHostsLine(host: string, port: number, key: Buffer): string {
  const parsed = parseSshPublicKeyBuffer(key);
  return `${knownHostsHostField(host, port)} ${parsed.type} ${parsed.base64}`;
}

export type KnownHostEntry = {
  hostField: string;
  type: string;
  base64: string;
};

export function parseKnownHosts(content: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    entries.push({ hostField: parts[0], type: parts[1], base64: parts[2] });
  }
  return entries;
}

export function findKnownHost(
  entries: KnownHostEntry[],
  host: string,
  port: number
): KnownHostEntry | undefined {
  const field = knownHostsHostField(host, port);
  return entries.find((e) => e.hostField === field);
}

export type HostVerifyResult =
  | { ok: true; pinned: boolean; line?: string }
  | { ok: false; reason: string };

/**
 * TOFU: pin on first sight; fail closed on mismatch.
 * Pure helper — tests do not need the filesystem.
 */
export function verifyOrPinHostKey(
  content: string,
  host: string,
  port: number,
  key: Buffer
): HostVerifyResult & { nextContent?: string } {
  const parsed = parseSshPublicKeyBuffer(key);
  const line = formatKnownHostsLine(host, port, key);
  const entries = parseKnownHosts(content);
  const existing = findKnownHost(entries, host, port);

  if (!existing) {
    const next = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
    return { ok: true, pinned: true, line, nextContent: `${next}${line}\n` };
  }

  if (existing.type === parsed.type && existing.base64 === parsed.base64) {
    return { ok: true, pinned: false, line };
  }

  return {
    ok: false,
    reason: `SSH host key mismatch for ${knownHostsHostField(host, port)} (type ${existing.type}). Refusing to connect. Remove the pin from the known_hosts file if this host was legitimately replaced.`,
  };
}

export function getKnownHostsPath(): string {
  if (process.env.LAZYBACKUP_KNOWN_HOSTS) {
    return path.resolve(process.env.LAZYBACKUP_KNOWN_HOSTS);
  }
  const url = (process.env.DATABASE_URL || 'file:./data.db').trim();
  if (url.startsWith('file:')) {
    let filePath = url.slice('file:'.length);
    if (filePath.startsWith('///')) {
      filePath = filePath.slice(2);
    } else if (filePath.startsWith('//')) {
      const idx = filePath.indexOf('/', 2);
      filePath = idx >= 0 ? filePath.slice(idx) : filePath;
    } else {
      filePath = path.resolve(filePath);
    }
    return path.join(path.dirname(filePath), 'ssh_known_hosts');
  }
  return path.join(path.resolve(process.env.BACKUP_STORAGE_PATH || './backups'), 'ssh_known_hosts');
}

function readKnownHostsSync(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * ssh2 hostVerifier: pin unknown keys, reject mismatches.
 * Must be synchronous (ssh2 handshake).
 */
export function createHostVerifier(host: string, port: number): (key: Buffer) => boolean {
  return (key: Buffer) => {
    try {
      const filePath = getKnownHostsPath();
      mkdirSync(path.dirname(filePath), { recursive: true });
      const current = readKnownHostsSync(filePath);
      const result = verifyOrPinHostKey(current, host, port, key);
      if (!result.ok) {
        console.error(result.reason);
        return false;
      }
      if (result.pinned && result.nextContent !== undefined) {
        writeFileSync(filePath, result.nextContent, { mode: 0o600 });
      }
      return true;
    } catch (err) {
      console.error('SSH host key verification failed:', err);
      return false;
    }
  };
}

export async function ensureKnownHostsFile(): Promise<string> {
  const filePath = getKnownHostsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '', { mode: 0o600 });
  }
  return filePath;
}

/** OpenSSH CLI options: TOFU via accept-new into the app known_hosts file. */
export function sshStrictHostKeyCliOptions(knownHostsPath: string): string[] {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${knownHostsPath}`,
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    'HashKnownHosts=no',
    '-o',
    'LogLevel=ERROR',
  ];
}
