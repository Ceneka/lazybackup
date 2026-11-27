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
 * Temp name for an in-progress staged copy. Kept next to the final object (so
 * the final rename is atomic on the same filesystem) and marked with
 * `.part-` so `listStagedObjects` never advertises a half-written artifact:
 * a peer that pulls mid-backup would store a truncated object whose digest can
 * never match the ACK, and a crashed copy would wedge that mailbox forever.
 */
export function peerStagingTempPath(peerId: string, objectKey: string): string {
  const dest = peerStagingObjectPath(peerId, objectKey);
  return `${dest}.part-${process.pid}-${randomBytes(6).toString('hex')}`;
}

/** True for in-progress staging temp files created by `peerStagingTempPath`. */
export function isStagingTempName(name: string): boolean {
  return name.includes('.part-');
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
      // In-progress copies are not pending outgoing bytes and must not double
      // count while an existing staged object is being replaced.
      if (isStagingTempName(entry.name)) continue;
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
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    // Copy + hash under a temp name: the object becomes visible to peers in a
    // single atomic rename only once it is complete.
    await fs.copyFile(localFilePath, temp);
    const st = await fs.stat(temp);
    const sha256 = await sha256File(temp);
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
  } catch {
    return null;
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
  } catch {
    return false;
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
        // Never advertise an in-progress copy: a peer would store a truncated
        // artifact it can never ACK.
        if (isStagingTempName(entry.name)) continue;
        const st = await fs.stat(full);
        out.push({ key, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  }

  await walk(root, '');
  return out;
}
