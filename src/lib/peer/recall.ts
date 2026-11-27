import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';
import { db } from '@/lib/db';
import { backupHistory, peerDeletes, peerRecalls } from '@/lib/db/schema';
import { writeCappedBodyToTempFile } from './capped-body';
import { assertFileSha256, sha256File } from './digest';
import { withPeerLock } from './peer-lock';
import {
  appendRecallChunk,
  PEER_RECALL_CHUNK_MAX_BYTES,
  planRecallChunks,
} from './recall-chunk';
import { PEER_UPLOAD_HARD_CAP_BYTES, PeerUploadLimitError } from './upload-limit';

export {
  PeerRecallPendingError,
  PEER_RECALL_WAITING_MESSAGE,
  peerRecallWaitingResponse,
} from './recall-pending';

const DEFAULT_TTL_MS = 24 * 3600 * 1000;
const DEFAULT_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 1500;

/** A recall that can never be fulfilled (failed digest, queued delete) — HTTP 400. */
export class PeerRecallBlockedError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PeerRecallBlockedError';
  }
}

/** The latest recall for this artifact failed; an explicit retry is required. */
export class PeerRecallFailedError extends PeerRecallBlockedError {
  constructor(message: string) {
    super(message);
    this.name = 'PeerRecallFailedError';
  }
}

function storageRoot(): string {
  return path.resolve(process.env.BACKUP_STORAGE_PATH || './backups');
}

export function peerRecallDir(peerId: string): string {
  return path.join(storageRoot(), 'peers-recall', peerId);
}

export function recallSpoolPath(peerId: string, recallId: string): string {
  return path.join(peerRecallDir(peerId), recallId, 'artifact');
}

export function recallPartialPath(peerId: string, recallId: string): string {
  return path.join(peerRecallDir(peerId), recallId, 'upload.part');
}

async function removeRecallDir(peerId: string, recallId: string): Promise<void> {
  await fs
    .rm(path.dirname(recallSpoolPath(peerId, recallId)), { recursive: true, force: true })
    .catch(() => {});
}

/**
 * Expire pending/uploading recalls and ready spools that nobody consumed within
 * the recall TTL. The spool file is unlinked too: otherwise a stale ready recall
 * keeps advertising the key as busy and blocks retention forever.
 */
export async function expireStaleRecalls(): Promise<void> {
  const now = new Date();
  const stale = await db.query.peerRecalls.findMany({
    where: and(
      inArray(peerRecalls.status, ['pending', 'uploading', 'ready']),
      lt(peerRecalls.expiresAt, now)
    ),
    columns: { id: true, peerId: true },
  });
  await db
    .update(peerRecalls)
    .set({ status: 'expired' })
    .where(
      and(
        inArray(peerRecalls.status, ['pending', 'uploading', 'ready']),
        lt(peerRecalls.expiresAt, now)
      )
    );
  for (const row of stale) {
    await removeRecallDir(row.peerId, row.id);
  }
}

/** Close open recalls for an object that is being deleted (so deletes can be advertised). */
export async function expireRecallsForObject(
  peerId: string,
  objectKey: string
): Promise<void> {
  const rows = await db.query.peerRecalls.findMany({
    where: and(
      eq(peerRecalls.peerId, peerId),
      eq(peerRecalls.objectKey, objectKey),
      inArray(peerRecalls.status, ['pending', 'uploading', 'ready'])
    ),
    columns: { id: true, peerId: true },
  });
  if (rows.length === 0) return;
  await db
    .update(peerRecalls)
    .set({ status: 'expired', error: 'Object is queued for deletion' })
    .where(
      and(
        eq(peerRecalls.peerId, peerId),
        eq(peerRecalls.objectKey, objectKey),
        inArray(peerRecalls.status, ['pending', 'uploading', 'ready'])
      )
    );
  for (const row of rows) {
    await removeRecallDir(row.peerId, row.id);
  }
}

/** Drop failed recalls so an explicit user retry can start a fresh transfer. */
export async function resetFailedRecall(options: {
  peerId?: string | null;
  objectKey?: string | null;
  historyId?: string | null;
}): Promise<number> {
  const where = options.historyId
    ? and(eq(peerRecalls.historyId, options.historyId), eq(peerRecalls.status, 'failed'))
    : options.peerId && options.objectKey
      ? and(
          eq(peerRecalls.peerId, options.peerId),
          eq(peerRecalls.objectKey, options.objectKey),
          eq(peerRecalls.status, 'failed')
        )
      : null;
  if (!where) return 0;
  const rows = await db.query.peerRecalls.findMany({
    where,
    columns: { id: true, peerId: true },
  });
  if (rows.length === 0) return 0;
  await db.delete(peerRecalls).where(where);
  for (const row of rows) {
    await removeRecallDir(row.peerId, row.id);
  }
  return rows.length;
}

async function latestRecallFor(options: {
  peerId: string;
  objectKey: string;
  historyId?: string | null;
}): Promise<typeof peerRecalls.$inferSelect | null> {
  const where = options.historyId
    ? eq(peerRecalls.historyId, options.historyId)
    : and(
        eq(peerRecalls.peerId, options.peerId),
        eq(peerRecalls.objectKey, options.objectKey)
      );
  return (
    (await db.query.peerRecalls.findFirst({
      where,
      orderBy: desc(peerRecalls.createdAt),
    })) ?? null
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
  /** Explicit user retry: forget a failed attempt instead of surfacing it. */
  retry?: boolean;
}): Promise<typeof peerRecalls.$inferSelect> {
  await expireStaleRecalls();

  if (options.retry) {
    await resetFailedRecall({
      peerId: options.peerId,
      objectKey: options.objectKey,
      historyId: options.historyId,
    });
  }

  const latest = await latestRecallFor(options);
  if (latest?.status === 'failed' && !options.retry) {
    const detail = latest.error?.trim();
    throw new PeerRecallFailedError(
      detail
        ? `The last attempt to get this backup from your friend failed: ${detail}. Retry the restore to ask again.`
        : 'The last attempt to get this backup from your friend failed. Retry the restore to ask again.'
    );
  }

  // A delete already queued for this key wins over a recall: otherwise the peer
  // could upload an object the host is about to delete (and retention would race).
  const deletion = await db.query.peerDeletes.findFirst({
    where: and(
      eq(peerDeletes.peerId, options.peerId),
      eq(peerDeletes.objectKey, options.objectKey)
    ),
  });
  if (deletion) {
    if (deletion.status === 'acked') {
      // A newer run may have re-landed the same non-versioned key after the
      // delete was acknowledged; that stale delete must not block its recall.
      const liveRow = await db.query.backupHistory.findFirst({
        where: and(
          eq(backupHistory.artifactPath, `peer://${options.peerId}/${options.objectKey}`),
          eq(backupHistory.artifactRemoved, false)
        ),
        columns: { id: true },
      });
      if (liveRow) {
        await db
          .delete(peerDeletes)
          .where(
            and(
              eq(peerDeletes.peerId, options.peerId),
              eq(peerDeletes.objectKey, options.objectKey),
              eq(peerDeletes.status, 'acked')
            )
          );
      } else {
        throw new PeerRecallBlockedError(
          'This backup was deleted from your friend’s disk and can no longer be restored. Run a new backup.'
        );
      }
    } else {
      throw new PeerRecallBlockedError(
        'This backup is queued for deletion on your friend’s disk. Wait for the deletion to finish, then run a new backup.'
      );
    }
  }

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
 * Stream a recall PUT under the per-peer lock with size ceiling.
 *
 * Deliberately not quota-checked against `peers/{peerId}`: a recall is the
 * peer handing back bytes this instance already owns (transient spool under
 * peers-recall/), so counting it against the storage quota would block
 * restores whenever the peer is near its quota.
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
    if (declaredBytes > quotaBytes) {
      // The artifact cannot be larger than what the peer was allowed to store.
      throw new Error(
        `Recall artifact (${declaredBytes} bytes) exceeds the peer quota (${quotaBytes} bytes)`
      );
    }
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

/**
 * Receive one chunk of a large recall upload. Chunks are fixed-size
 * (PEER_RECALL_CHUNK_MAX_BYTES) so reverse proxies with small request-body
 * limits (Cloudflare Tunnel: 100 MB) never see the whole artifact. A plain
 * single-body upload remains supported for older clients.
 *
 * Returns `done: false` until the last chunk, then finalizes with the existing
 * SHA-256 check. Chunk 0 restarts a partial upload; later chunks must be in order.
 */
export async function ingestRecallChunk(options: {
  recallId: string;
  peerId: string;
  quotaBytes: number;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  declaredBytes: number;
  body: ReadableStream<Uint8Array> | null;
}): Promise<{
  done: boolean;
  receivedBytes: number;
  size?: number;
  sha256?: string;
}> {
  const {
    recallId,
    peerId,
    quotaBytes,
    chunkIndex,
    chunkCount,
    totalBytes,
    declaredBytes,
    body,
  } = options;

  // The artifact came from this peer's storage, so it can never exceed the
  // agreed quota (nor the hard upload cap).
  const maxTotal = Math.min(
    PEER_UPLOAD_HARD_CAP_BYTES,
    quotaBytes > 0 ? quotaBytes : PEER_UPLOAD_HARD_CAP_BYTES
  );
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new PeerUploadLimitError('Invalid recall upload size', 400);
  }
  if (totalBytes > maxTotal) {
    throw new PeerUploadLimitError(
      `Recall upload exceeds maximum of ${maxTotal} bytes`,
      413
    );
  }

  const chunks = planRecallChunks(totalBytes, PEER_RECALL_CHUNK_MAX_BYTES);
  if (!Number.isSafeInteger(chunkCount) || chunkCount !== chunks.length) {
    throw new PeerUploadLimitError(
      `Invalid recall chunk count: expected ${chunks.length}, got ${chunkCount}`,
      400
    );
  }
  const plan = chunks[chunkIndex];
  if (!plan) {
    throw new PeerUploadLimitError('Invalid recall chunk index', 400);
  }
  if (declaredBytes !== plan.length) {
    throw new PeerUploadLimitError(
      `Recall chunk size mismatch: expected ${plan.length} bytes, got ${declaredBytes}`,
      400
    );
  }

  return withPeerLock(peerId, async () => {
    const row = await getRecall(recallId);
    if (!row || row.peerId !== peerId) {
      throw new PeerUploadLimitError('Recall not found', 404);
    }
    if (row.status === 'expired' || row.status === 'consumed' || row.status === 'failed') {
      throw new PeerUploadLimitError(`Recall is ${row.status}`, 400);
    }

    const ingested = await writeCappedBodyToTempFile(body, plan.length);
    try {
      if (ingested.size !== plan.length) {
        throw new PeerUploadLimitError(
          `Content-Length mismatch: declared ${plan.length} bytes, received ${ingested.size}`,
          400
        );
      }

      const partialPath = recallPartialPath(peerId, recallId);
      const receivedBytes = await appendRecallChunk({
        partialPath,
        chunkIndex,
        expectedOffset: plan.start,
        chunkPath: ingested.tempPath,
        expectedChunkBytes: plan.length,
      });

      if (chunkIndex < chunks.length - 1) {
        return { done: false, receivedBytes };
      }
      if (receivedBytes !== totalBytes) {
        throw new PeerUploadLimitError(
          `Recall upload incomplete: expected ${totalBytes} bytes, got ${receivedBytes}`,
          400
        );
      }

      const completed = await completeRecallUpload(recallId, peerId, partialPath);
      await fs.unlink(partialPath).catch(() => {});
      return { done: true, receivedBytes, ...completed };
    } catch (error) {
      // Keep the partial only when another chunked attempt can still complete.
      const current = await getRecall(recallId);
      if (
        !current ||
        current.status === 'failed' ||
        current.status === 'expired' ||
        current.status === 'consumed'
      ) {
        await removeRecallDir(peerId, recallId);
      }
      throw error;
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
