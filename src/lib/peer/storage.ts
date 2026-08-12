import fs from 'fs/promises';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';

export function getPeerStorageRoot(): string {
  const root = process.env.BACKUP_STORAGE_PATH || './backups';
  return path.resolve(root, 'peers');
}

export function peerDataDir(peerId: string): string {
  return path.join(getPeerStorageRoot(), peerId);
}

export function peerObjectPath(peerId: string, objectKey: string): string {
  const safe = objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.includes('..')) {
    throw new Error('Invalid object key');
  }
  return path.join(peerDataDir(peerId), safe);
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

export async function recalculatePeerUsedBytes(peerId: string): Promise<number> {
  const used = await dirSize(peerDataDir(peerId));
  await db
    .update(peers)
    .set({ usedBytes: used, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(peers.id, peerId));
  return used;
}

export async function assertPeerQuota(
  peerId: string,
  quotaBytes: number,
  additionalBytes: number,
  replacingObjectKey?: string
): Promise<void> {
  let used = await dirSize(peerDataDir(peerId));
  if (replacingObjectKey) {
    try {
      const existing = await fs.stat(peerObjectPath(peerId, replacingObjectKey));
      used = Math.max(0, used - existing.size);
    } catch {
      // new object
    }
  }
  if (used + additionalBytes > quotaBytes) {
    const remain = Math.max(0, quotaBytes - used);
    throw new Error(
      `Peer quota exceeded: need ${additionalBytes} bytes, only ${remain} bytes remaining of ${quotaBytes}`
    );
  }
}

export async function writePeerObject(
  peerId: string,
  objectKey: string,
  data: Buffer,
  quotaBytes: number
): Promise<{ size: number; usedBytes: number }> {
  await assertPeerQuota(peerId, quotaBytes, data.byteLength, objectKey);
  const dest = peerObjectPath(peerId, objectKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
  const usedBytes = await recalculatePeerUsedBytes(peerId);
  return { size: data.byteLength, usedBytes };
}

export async function readPeerObject(
  peerId: string,
  objectKey: string
): Promise<Buffer> {
  const dest = peerObjectPath(peerId, objectKey);
  return fs.readFile(dest);
}

export async function deletePeerObjectFile(
  peerId: string,
  objectKey: string
): Promise<{ usedBytes: number }> {
  const dest = peerObjectPath(peerId, objectKey);
  await fs.unlink(dest).catch(() => {});
  const usedBytes = await recalculatePeerUsedBytes(peerId);
  return { usedBytes };
}

export async function listPeerObjects(peerId: string): Promise<
  Array<{ key: string; size: number; mtime: string }>
> {
  const root = peerDataDir(peerId);
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
