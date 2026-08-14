import fs from 'fs/promises';
import { createReadStream } from 'fs';
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

export async function writeStagedObject(
  peerId: string,
  objectKey: string,
  localFilePath: string
): Promise<{ size: number; sha256: string }> {
  const dest = peerStagingObjectPath(peerId, objectKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(localFilePath, dest);
  const st = await fs.stat(dest);
  const sha256 = await sha256File(dest);
  return { size: st.size, sha256 };
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
        const st = await fs.stat(full);
        out.push({ key, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  }

  await walk(root, '');
  return out;
}
