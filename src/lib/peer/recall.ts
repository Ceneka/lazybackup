import { and, eq, inArray, lt } from 'drizzle-orm';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';
import { db } from '@/lib/db';
import { backupHistory, peerRecalls } from '@/lib/db/schema';
import { writeCappedBodyToTempFile } from './capped-body';
import { assertFileSha256, sha256File } from './digest';
import { withPeerLock } from './peer-lock';
import { assertPeerQuota } from './storage';

export {
  PeerRecallPendingError,
  PEER_RECALL_WAITING_MESSAGE,
  peerRecallWaitingResponse,
} from './recall-pending';

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

/** Keys with a recall still in flight (including ready-but-unconsumed). */
export async function listObjectKeysWithOpenRecalls(peerId: string): Promise<Set<string>> {
  await expireStaleRecalls();
  const rows = await db.query.peerRecalls.findMany({
    where: and(
      eq(peerRecalls.peerId, peerId),
      inArray(peerRecalls.status, ['pending', 'uploading', 'ready'])
    ),
  });
  return new Set(rows.map((r) => r.objectKey));
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
  localFilePath: string,
  receivedSha256?: string
): Promise<{ size: number; sha256: string }> {
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
  await fs.copyFile(localFilePath, dest);
  const st = await fs.stat(dest);
  const sha256 = receivedSha256 || (await sha256File(dest));

  const expected = await expectedRecallDigest(row);
  if (expected) {
    try {
      await assertFileSha256(dest, expected, 'recall artifact');
    } catch (error) {
      await fs.unlink(dest).catch(() => {});
      await db
        .update(peerRecalls)
        .set({ status: 'failed', error: error instanceof Error ? error.message : 'digest mismatch' })
        .where(eq(peerRecalls.id, recallId));
      throw error;
    }
  }

  await db
    .update(peerRecalls)
    .set({ status: 'ready', readyAt: new Date(), error: null })
    .where(eq(peerRecalls.id, recallId));
  return { size: st.size, sha256 };
}

async function expectedRecallDigest(
  row: typeof peerRecalls.$inferSelect
): Promise<string | null> {
  if (row.historyId) {
    const history = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, row.historyId),
      columns: { artifactSha256: true },
    });
    if (history?.artifactSha256) return history.artifactSha256;
  }
  const artifactPath = `peer://${row.peerId}/${row.objectKey}`;
  const byPath = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.artifactPath, artifactPath),
    columns: { artifactSha256: true },
  });
  return byPath?.artifactSha256 ?? null;
}

/**
 * Stream a recall PUT under the per-peer lock with quota + size ceiling.
 */
export async function ingestRecallUpload(options: {
  recallId: string;
  peerId: string;
  quotaBytes: number;
  declaredBytes: number;
  body: ReadableStream<Uint8Array> | null;
}): Promise<{ size: number; sha256: string }> {
  const { recallId, peerId, quotaBytes, declaredBytes, body } = options;
  return withPeerLock(peerId, async () => {
    await assertPeerQuota(peerId, quotaBytes, declaredBytes);
    const ingested = await writeCappedBodyToTempFile(body, declaredBytes);
    try {
      if (ingested.size !== declaredBytes) {
        throw new Error(
          `Content-Length mismatch: declared ${declaredBytes} bytes, received ${ingested.size}`
        );
      }
      if (ingested.size === 0) {
        throw new Error('Empty body');
      }
      return await completeRecallUpload(recallId, peerId, ingested.tempPath, ingested.sha256);
    } finally {
      await ingested.cleanup();
    }
  });
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
 * Restore/download no longer call this — they throw PeerRecallPendingError for HTTP 202.
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
