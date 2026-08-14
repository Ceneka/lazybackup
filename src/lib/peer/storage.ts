import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';
import { moveCappedTempToDest, writeCappedBodyToTempFile } from './capped-body';
import { withPeerLock } from './peer-lock';

export function getPeerStorageRoot(): string {
  const root = process.env.BACKUP_STORAGE_PATH || './backups';
  return path.resolve(root, 'peers');
}

export function assertSafePeerObjectKey(objectKey: string): string {
  const safe = objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.includes('..')) {
    throw new Error('Invalid object key');
  }
  return safe;
}

export function peerDataDir(peerId: string): string {
  return path.join(getPeerStorageRoot(), peerId);
}

export function peerObjectPath(peerId: string, objectKey: string): string {
  const safe = assertSafePeerObjectKey(objectKey);
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

export async function existingObjectSize(
  peerId: string,
  objectKey: string
): Promise<number> {
  try {
    const existing = await fs.stat(peerObjectPath(peerId, objectKey));
    return existing.size;
  } catch {
    return 0;
  }
}

export async function assertPeerQuota(
  peerId: string,
  quotaBytes: number,
  additionalBytes: number,
  replacingObjectKey?: string
): Promise<void> {
  let used = await dirSize(peerDataDir(peerId));
  if (replacingObjectKey) {
    used = Math.max(0, used - (await existingObjectSize(peerId, replacingObjectKey)));
  }
  if (used + additionalBytes > quotaBytes) {
    const remain = Math.max(0, quotaBytes - used);
    throw new Error(
      `Peer quota exceeded: need ${additionalBytes} bytes, only ${remain} bytes remaining of ${quotaBytes}`
    );
  }
}

async function commitPeerObjectFile(
  peerId: string,
  objectKey: string,
  srcPath: string,
  size: number
): Promise<{ size: number; usedBytes: number }> {
  const dest = peerObjectPath(peerId, objectKey);
  await moveCappedTempToDest(srcPath, dest);
  const usedBytes = await recalculatePeerUsedBytes(peerId);
  return { size, usedBytes };
}

/**
 * Stream a store PUT body under the per-peer lock: quota check then capped write.
 */
export async function ingestPeerObjectUpload(options: {
  peerId: string;
  objectKey: string;
  quotaBytes: number;
  declaredBytes: number;
  body: ReadableStream<Uint8Array> | null;
}): Promise<{ size: number; usedBytes: number; sha256: string }> {
  const { peerId, objectKey, quotaBytes, declaredBytes, body } = options;
  return withPeerLock(peerId, async () => {
    await assertPeerQuota(peerId, quotaBytes, declaredBytes, objectKey);
    const ingested = await writeCappedBodyToTempFile(body, declaredBytes);
    try {
      if (ingested.size !== declaredBytes) {
        throw new Error(
          `Content-Length mismatch: declared ${declaredBytes} bytes, received ${ingested.size}`
        );
      }
      const written = await commitPeerObjectFile(
        peerId,
        objectKey,
        ingested.tempPath,
        ingested.size
      );
      return { ...written, sha256: ingested.sha256 };
    } finally {
      await ingested.cleanup();
    }
  });
}

export async function writePeerObject(
  peerId: string,
  objectKey: string,
  data: Buffer,
  quotaBytes: number
): Promise<{ size: number; usedBytes: number }> {
  return withPeerLock(peerId, async () => {
    await assertPeerQuota(peerId, quotaBytes, data.byteLength, objectKey);
    const dest = peerObjectPath(peerId, objectKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    const usedBytes = await recalculatePeerUsedBytes(peerId);
    return { size: data.byteLength, usedBytes };
  });
}

export async function openPeerObjectStream(
  peerId: string,
  objectKey: string
): Promise<{ size: number; stream: ReturnType<typeof createReadStream> }> {
  const dest = peerObjectPath(peerId, objectKey);
  const stat = await fs.stat(dest);
  if (!stat.isFile()) throw new Error('Object is not a file');
  return { size: stat.size, stream: createReadStream(dest) };
}

export async function deletePeerObjectFile(
  peerId: string,
  objectKey: string
): Promise<{ usedBytes: number }> {
  return withPeerLock(peerId, async () => {
    const dest = peerObjectPath(peerId, objectKey);
    await fs.unlink(dest).catch(() => {});
    const usedBytes = await recalculatePeerUsedBytes(peerId);
    return { usedBytes };
  });
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
