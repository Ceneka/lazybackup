import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { sha256File } from './digest';

/**
 * Outbound mailbox staging: objects waiting for the peer to pull.
 * {BACKUP_STORAGE_PATH}/peers-staging/{peerId}/{objectKey}
 */

function storageRoot(): string {
  return path.resolve(process.env.BACKUP_STORAGE_PATH || './backups');
}

export function getPeerStagingRoot(): string {
  return path.join(storageRoot(), 'peers-staging');
}

export function peerStagingDir(peerId: string): string {
  return path.join(getPeerStagingRoot(), peerId);
}

export function peerStagingObjectPath(peerId: string, objectKey: string): string {
  const safe = objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.includes('..')) {
    throw new Error('Invalid object key');
  }
  return path.join(peerStagingDir(peerId), safe);
}

/**
 * In-progress copies live outside the peer's object namespace so a legitimate
 * object key can never be mistaken for a temp file (`.part-` is legal in a
 * source path, database dump or Docker volume name). The directory is a
 * sibling of every peer dir, on the same filesystem as the final rename.
 */
export function peerStagingTempDir(peerId: string): string {
  return path.join(getPeerStagingRoot(), '.incoming', peerId);
}

/**
 * Temp path for an in-progress staged copy. The final rename into the peer
 * namespace is atomic: peers never see a half-written artifact, and a crashed
 * copy cannot wedge the mailbox with an un-ACKable object.
 */
export function peerStagingTempPath(peerId: string, _objectKey: string): string {
  return path.join(
    peerStagingTempDir(peerId),
    `${process.pid}-${randomBytes(6).toString('hex')}`
  );
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      const st = await fs.stat(full);
      total += st.size;
    }
  }
  return total;
}

export async function stagingUsedBytes(peerId: string): Promise<number> {
  return dirSize(peerStagingDir(peerId));
}

function formatGb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GB`;
}

/**
 * Refuse to stage a mailbox artifact that would push the peer's pending outgoing
 * bytes above the agreed quota. A non-versioned destination reuses the same key,
 * so an existing staged copy is replaced (its bytes do not count twice).
 */
export async function assertStagingQuota(options: {
  peerId: string;
  quotaBytes: number;
  additionalBytes: number;
  replacingObjectKey?: string;
}): Promise<void> {
  const { peerId, quotaBytes, additionalBytes, replacingObjectKey } = options;
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return;
  let used = await stagingUsedBytes(peerId);
  if (replacingObjectKey) {
    const existing = await fs.stat(peerStagingObjectPath(peerId, replacingObjectKey)).catch(
      () => null
    );
    if (existing?.isFile()) {
      used = Math.max(0, used - existing.size);
    }
  }
  if (used + additionalBytes > quotaBytes) {
    const free = Math.max(0, quotaBytes - used);
    throw new Error(
      `Bro Space quota exceeded: this backup needs ${formatGb(additionalBytes)} but only ${formatGb(free)} of ${formatGb(quotaBytes)} is free. Delete older backups on this bro or raise the quota.`
    );
  }
}

export async function writeStagedObject(
  peerId: string,
  objectKey: string,
  localFilePath: string
): Promise<{ size: number; sha256: string }> {
  const dest = peerStagingObjectPath(peerId, objectKey);
  const temp = peerStagingTempPath(peerId, objectKey);
  try {
    // Copy + hash under a private temp dir: the object becomes visible to
    // peers in a single atomic rename only once it is complete.
    await fs.mkdir(path.dirname(temp), { recursive: true });
    await fs.copyFile(localFilePath, temp);
    const st = await fs.stat(temp);
    const sha256 = await sha256File(temp);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(temp, dest);
    return { size: st.size, sha256 };
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

export async function stagedObjectDigest(
  peerId: string,
  objectKey: string
): Promise<{ size: number; sha256: string } | null> {
  try {
    const dest = peerStagingObjectPath(peerId, objectKey);
    const st = await fs.stat(dest);
    const sha256 = await sha256File(dest);
    return { size: st.size, sha256 };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function openStagedObjectStream(
  peerId: string,
  objectKey: string
): Promise<{ size: number; stream: ReturnType<typeof createReadStream> }> {
  const dest = peerStagingObjectPath(peerId, objectKey);
  const stat = await fs.stat(dest);
  if (!stat.isFile()) throw new Error('Staged object is not a file');
  return { size: stat.size, stream: createReadStream(dest) };
}

export async function stagedObjectExists(
  peerId: string,
  objectKey: string
): Promise<boolean> {
  try {
    await fs.access(peerStagingObjectPath(peerId, objectKey));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Only "not there" means the ACK already consumed it. A permission or I/O
    // error must not be mistaken for a verified delivery.
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function deleteStagedObject(
  peerId: string,
  objectKey: string
): Promise<void> {
  await fs.unlink(peerStagingObjectPath(peerId, objectKey)).catch(() => {});
}

export async function listStagedObjects(
  peerId: string
): Promise<Array<{ key: string; size: number; mtime: string }>> {
  const root = peerStagingDir(peerId);
  const out: Array<{ key: string; size: number; mtime: string }> = [];

  async function walk(dir: string, prefix: string) {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, key);
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        out.push({ key, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  }

  await walk(root, '');
  return out;
}
