import { and, eq, inArray, lt } from 'drizzle-orm';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';
import { db } from '@/lib/db';
import { peerRecalls } from '@/lib/db/schema';

const DEFAULT_TTL_MS = 24 * 3600 * 1000;
const DEFAULT_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 1500;

function storageRoot(): string {
  return path.resolve(process.env.BACKUP_STORAGE_PATH || './backups');
}

export function recallSpoolPath(peerId: string, recallId: string): string {
  return path.join(storageRoot(), 'peers-recall', peerId, recallId, 'artifact');
}

export async function expireStaleRecalls(): Promise<void> {
  const now = new Date();
  await db
    .update(peerRecalls)
    .set({ status: 'expired' })
    .where(
      and(
        inArray(peerRecalls.status, ['pending', 'uploading']),
        lt(peerRecalls.expiresAt, now)
      )
    );
}

/**
 * Create or reuse an open recall for (peerId, objectKey).
 */
export async function ensureRecall(options: {
  peerId: string;
  objectKey: string;
  historyId?: string | null;
  ttlMs?: number;
}): Promise<typeof peerRecalls.$inferSelect> {
  await expireStaleRecalls();

  const existing = await db.query.peerRecalls.findFirst({
    where: and(
      eq(peerRecalls.peerId, options.peerId),
      eq(peerRecalls.objectKey, options.objectKey),
      inArray(peerRecalls.status, ['pending', 'uploading', 'ready'])
    ),
  });
  if (existing) return existing;

  const id = nanoid();
  const expiresAt = new Date(Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS));
  await db.insert(peerRecalls).values({
    id,
    peerId: options.peerId,
    objectKey: options.objectKey,
    historyId: options.historyId ?? null,
    status: 'pending',
    expiresAt,
    createdAt: new Date(),
  });
  const row = await db.query.peerRecalls.findFirst({ where: eq(peerRecalls.id, id) });
  if (!row) throw new Error('Failed to create recall');
  return row;
}

export async function listOpenRecallsForPeer(
  peerId: string
): Promise<Array<{ id: string; objectKey: string }>> {
  await expireStaleRecalls();
  const rows = await db.query.peerRecalls.findMany({
    where: and(
      eq(peerRecalls.peerId, peerId),
      inArray(peerRecalls.status, ['pending', 'uploading'])
    ),
  });
  return rows.map((r) => ({ id: r.id, objectKey: r.objectKey }));
}

export async function getRecall(
  recallId: string
): Promise<typeof peerRecalls.$inferSelect | null> {
  return (
    (await db.query.peerRecalls.findFirst({ where: eq(peerRecalls.id, recallId) })) ??
    null
  );
}

export async function markRecallUploading(recallId: string): Promise<void> {
  await db
    .update(peerRecalls)
    .set({ status: 'uploading' })
    .where(and(eq(peerRecalls.id, recallId), eq(peerRecalls.status, 'pending')));
}

export async function completeRecallUpload(
  recallId: string,
  peerId: string,
  data: Buffer
): Promise<void> {
  const row = await getRecall(recallId);
  if (!row || row.peerId !== peerId) {
    throw new Error('Recall not found');
  }
  if (row.status === 'expired' || row.status === 'consumed' || row.status === 'failed') {
    throw new Error(`Recall is ${row.status}`);
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(peerRecalls)
      .set({ status: 'expired' })
      .where(eq(peerRecalls.id, recallId));
    throw new Error('Recall has expired');
  }

  const dest = recallSpoolPath(peerId, recallId);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
  await db
    .update(peerRecalls)
    .set({ status: 'ready', readyAt: new Date() })
    .where(eq(peerRecalls.id, recallId));
}

export async function consumeRecallArtifact(
  recallId: string,
  peerId: string,
  destPath: string
): Promise<void> {
  const row = await getRecall(recallId);
  if (!row || row.peerId !== peerId) {
    throw new Error('Recall not found');
  }
  if (row.status !== 'ready') {
    throw new Error(`Recall is not ready (status=${row.status})`);
  }
  const src = recallSpoolPath(peerId, recallId);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(src, destPath);
  await fs.unlink(src).catch(() => {});
  await db
    .update(peerRecalls)
    .set({ status: 'consumed', consumedAt: new Date() })
    .where(eq(peerRecalls.id, recallId));
}

export type WaitRecallResult =
  | { status: 'ready'; recallId: string }
  | { status: 'waiting'; recallId: string; message: string }
  | { status: 'expired'; recallId: string };

/**
 * Poll until recall is ready, or return waiting after timeout (recall stays pending).
 */
export async function waitForRecall(
  recallId: string,
  waitMs: number = DEFAULT_WAIT_MS
): Promise<WaitRecallResult> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const row = await getRecall(recallId);
    if (!row) {
      return { status: 'expired', recallId };
    }
    if (row.status === 'ready') {
      return { status: 'ready', recallId };
    }
    if (row.status === 'expired' || row.status === 'failed') {
      return { status: 'expired', recallId };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return {
    status: 'waiting',
    recallId,
    message: 'Waiting for Bro to connect and fulfill the recall',
  };
}
