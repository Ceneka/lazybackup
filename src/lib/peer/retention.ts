import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { backupHistory, peerDeletes } from '@/lib/db/schema';
import {
  selectPeerKeysForFileRetention,
  selectPeerKeysForVersionRetention,
  type PeerObjectCandidate,
  type RetentionAgeUnit,
} from '@/lib/backup/file-retention';
import { normalizeS3Prefix } from '@/lib/backup/destination';
import { deletePeerObject } from './client';
import { listObjectKeysWithOpenRecalls } from './recall';
import { deleteStagedObject } from './staging';
import { assertSafePeerObjectKey } from './storage';
import type { PeerRow } from './types';
import {
  advertiseMailboxDeletes,
  parsePeerArtifactPath,
} from './retention-helpers';

export { advertiseMailboxDeletes, parsePeerArtifactPath };

export const ARTIFACT_REMOVED_BY_RETENTION = 'artifact removed by retention';

export async function assertPeerArtifactRestorable(
  artifactPath: string,
  historyId?: string | null
): Promise<void> {
  if (historyId) {
    const row = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, historyId),
      columns: { artifactRemoved: true },
    });
    if (row?.artifactRemoved) {
      throw new Error(ARTIFACT_REMOVED_BY_RETENTION);
    }
  }

  const parsed = parsePeerArtifactPath(artifactPath);
  if (!parsed) return;

  const acked = await db.query.peerDeletes.findFirst({
    where: and(
      eq(peerDeletes.peerId, parsed.peerId),
      eq(peerDeletes.objectKey, parsed.objectKey),
      eq(peerDeletes.status, 'acked')
    ),
  });
  if (acked) {
    throw new Error(ARTIFACT_REMOVED_BY_RETENTION);
  }
}

async function listPeerHistoryObjects(
  configId: string,
  peerId: string
): Promise<PeerObjectCandidate[]> {
  const rows = await db.query.backupHistory.findMany({
    where: and(eq(backupHistory.configId, configId), eq(backupHistory.status, 'success')),
  });
  const byKey = new Map<string, PeerObjectCandidate>();
  for (const row of rows) {
    if (row.artifactRemoved) continue;
    if (!row.artifactPath) continue;
    const parsed = parsePeerArtifactPath(row.artifactPath);
    if (!parsed || parsed.peerId !== peerId) continue;
    const mtimeMs = (row.endTime ?? row.startTime).getTime();
    const prev = byKey.get(parsed.objectKey);
    if (!prev || mtimeMs > prev.mtimeMs) {
      byKey.set(parsed.objectKey, { key: parsed.objectKey, mtimeMs });
    }
  }
  return [...byKey.values()];
}

function mergeCandidates(
  existing: PeerObjectCandidate[],
  extra: PeerObjectCandidate[] | undefined
): PeerObjectCandidate[] {
  const byKey = new Map(existing.map((obj) => [obj.key, obj]));
  for (const obj of extra || []) {
    const prev = byKey.get(obj.key);
    if (!prev || obj.mtimeMs > prev.mtimeMs) {
      byKey.set(obj.key, obj);
    }
  }
  return [...byKey.values()];
}

export async function listPendingDeleteKeys(peerId: string): Promise<string[]> {
  const rows = await db.query.peerDeletes.findMany({
    where: and(eq(peerDeletes.peerId, peerId), eq(peerDeletes.status, 'pending')),
  });
  return rows.map((row) => row.objectKey);
}

export async function listPendingDeletesForWork(
  peerId: string
): Promise<Array<{ key: string }>> {
  const [pendingKeys, openRecallKeys] = await Promise.all([
    listPendingDeleteKeys(peerId),
    listObjectKeysWithOpenRecalls(peerId),
  ]);
  return advertiseMailboxDeletes(pendingKeys, openRecallKeys);
}

export async function getPeerDelete(
  peerId: string,
  objectKey: string
): Promise<typeof peerDeletes.$inferSelect | null> {
  return (
    (await db.query.peerDeletes.findFirst({
      where: and(eq(peerDeletes.peerId, peerId), eq(peerDeletes.objectKey, objectKey)),
    })) ?? null
  );
}

export async function enqueueMailboxDeletes(
  peerId: string,
  keys: string[]
): Promise<string[]> {
  const queued: string[] = [];
  for (const rawKey of keys) {
    let objectKey: string;
    try {
      objectKey = assertSafePeerObjectKey(rawKey);
    } catch {
      continue;
    }
    const existing = await getPeerDelete(peerId, objectKey);
    if (existing?.status === 'acked') {
      await markPeerArtifactRemoved(peerId, objectKey);
      continue;
    }
    if (existing?.status === 'pending') {
      queued.push(objectKey);
      continue;
    }
    await db.insert(peerDeletes).values({
      id: nanoid(),
      peerId,
      objectKey,
      status: 'pending',
      createdAt: new Date(),
    });
    queued.push(objectKey);
  }
  return queued;
}

export async function markPeerArtifactRemoved(
  peerId: string,
  objectKey: string
): Promise<void> {
  const artifactPath = `peer://${peerId}/${objectKey}`;
  await db
    .update(backupHistory)
    .set({ artifactRemoved: true, mailboxPending: false })
    .where(eq(backupHistory.artifactPath, artifactPath));
}

export async function completePeerDeleteAck(
  peerId: string,
  objectKey: string
): Promise<void> {
  const safe = assertSafePeerObjectKey(objectKey);
  await db
    .update(peerDeletes)
    .set({ status: 'acked', ackedAt: new Date() })
    .where(
      and(
        eq(peerDeletes.peerId, peerId),
        eq(peerDeletes.objectKey, safe),
        eq(peerDeletes.status, 'pending')
      )
    );
  await markPeerArtifactRemoved(peerId, safe);
  await deleteStagedObject(peerId, safe);
}

export async function applyPeerDestinationRetention(options: {
  configId: string;
  peer: PeerRow;
  destinationPath: string;
  enableVersioning: boolean;
  versionsToKeep?: number | null;
  enableFileRetention?: boolean | null;
  retentionMaxAge?: number | null;
  retentionMaxAgeUnit?: RetentionAgeUnit | null;
  retentionMinKeep?: number | null;
  extraObjects?: PeerObjectCandidate[];
}): Promise<{ keys: string[] }> {
  const prefix = normalizeS3Prefix(options.destinationPath);
  const objects = mergeCandidates(
    await listPeerHistoryObjects(options.configId, options.peer.id),
    options.extraObjects
  );

  let selected: string[] = [];
  if (options.enableVersioning && options.versionsToKeep) {
    selected = selectPeerKeysForVersionRetention(objects, prefix, options.versionsToKeep);
  } else if (
    !options.enableVersioning &&
    options.enableFileRetention &&
    options.retentionMaxAge &&
    options.retentionMinKeep
  ) {
    selected = selectPeerKeysForFileRetention(objects, prefix, {
      maxAge: options.retentionMaxAge,
      unit: options.retentionMaxAgeUnit || 'days',
      minKeep: options.retentionMinKeep,
    });
  }

  if (selected.length === 0) return { keys: [] };

  if (options.peer.transport === 'direct') {
    const deleted: string[] = [];
    const openRecalls = await listObjectKeysWithOpenRecalls(options.peer.id);
    for (const key of selected) {
      if (openRecalls.has(key)) continue;
      try {
        await deletePeerObject(options.peer, key);
        await markPeerArtifactRemoved(options.peer.id, key);
        deleted.push(key);
      } catch (error) {
        console.warn(
          `[peer-retention] direct delete ${key}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    return { keys: deleted };
  }

  const queued = await enqueueMailboxDeletes(options.peer.id, selected);
  return { keys: queued };
}
