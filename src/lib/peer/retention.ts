import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { backupHistory, peerDeletes, peers } from '@/lib/db/schema';
import {
  relativeKeyUnderPrefix,
  selectPeerKeysForFileRetention,
  selectPeerKeysForVersionRetention,
  type PeerObjectCandidate,
  type RetentionAgeUnit,
} from '@/lib/backup/file-retention';
import { normalizeS3Prefix } from '@/lib/backup/destination';
import { deletePeerObject } from './client';
import { withPeerLock } from './peer-lock';
import { expireRecallsForObject, listObjectKeysWithOpenRecalls } from './recall';
import { deleteStagedObject } from './staging';
import { assertSafePeerObjectKey } from './storage';
import type { PeerRow } from './types';
import {
  advertiseMailboxDeletes,
  parsePeerArtifactPath,
} from './retention-helpers';

export { advertiseMailboxDeletes, parsePeerArtifactPath };

export const ARTIFACT_REMOVED_BY_RETENTION = 'artifact removed by retention';
/** A non-versioned destination reused this object key for a newer run. */
export const ARTIFACT_SUPERSEDED_MESSAGE =
  'This backup was replaced by a newer run (versioning is off for this backup)';

export async function assertPeerArtifactRestorable(
  artifactPath: string,
  historyId?: string | null
): Promise<void> {
  if (historyId) {
    const row = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, historyId),
      columns: { artifactRemoved: true, artifactRemovedReason: true },
    });
    if (row?.artifactRemoved) {
      throw new Error(
        row.artifactRemovedReason?.trim() || ARTIFACT_REMOVED_BY_RETENTION
      );
    }
    // The per-run flag is authoritative: markPeerArtifactRemoved() sets it on
    // every row that existed at ACK time. A row that still says false was
    // landed afterwards, reusing the same object key, and is restorable.
    if (row) return;
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
  // Retention runs after every successful peer backup. Select only the fields
  // needed to compute keys; full rows would pull log_output/config_snapshot.
  const rows = await db.query.backupHistory.findMany({
    where: and(eq(backupHistory.configId, configId), eq(backupHistory.status, 'success')),
    columns: {
      id: true,
      artifactPath: true,
      startTime: true,
      endTime: true,
      artifactRemoved: true,
    },
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
  objectKey: string,
  reason: string = ARTIFACT_REMOVED_BY_RETENTION
): Promise<void> {
  const artifactPath = `peer://${peerId}/${objectKey}`;
  await db
    .update(backupHistory)
    .set({
      artifactRemoved: true,
      artifactRemovedReason: reason,
      mailboxPending: false,
    })
    .where(eq(backupHistory.artifactPath, artifactPath));
}

/**
 * Non-versioned peer destinations reuse the same object key. When a new run
 * lands there, older history rows point at bytes that no longer exist on the
 * friend's disk: mark them removed with a clear reason instead of letting a
 * restore fail later with a confusing SHA-256 mismatch.
 */
export async function markSupersededPeerHistory(options: {
  peerId: string;
  objectKey: string;
  currentHistoryId: string;
}): Promise<number> {
  const artifactPath = `peer://${options.peerId}/${options.objectKey}`;
  const updated = await db
    .update(backupHistory)
    .set({
      artifactRemoved: true,
      artifactRemovedReason: ARTIFACT_SUPERSEDED_MESSAGE,
      mailboxPending: false,
    })
    .where(
      and(
        eq(backupHistory.artifactPath, artifactPath),
        eq(backupHistory.artifactRemoved, false),
        ne(backupHistory.id, options.currentHistoryId)
      )
    )
    .returning({ id: backupHistory.id });
  return updated.length;
}

/**
 * A fresh artifact is landing on this key: every delete recorded for the old
 * object is obsolete. Clearing acked rows too matters for recalls — otherwise
 * an old acked delete would keep blocking restores of the reused key.
 */
/** Caller must hold `withPeerLock(peerId)` (the lock is not reentrant). */
export async function clearPeerDeletesForNewLandingUnlocked(
  peerId: string,
  objectKey: string
): Promise<void> {
  const safe = assertSafePeerObjectKey(objectKey);
  await db
    .delete(peerDeletes)
    .where(and(eq(peerDeletes.peerId, peerId), eq(peerDeletes.objectKey, safe)));
}

export async function clearPeerDeletesForNewLanding(
  peerId: string,
  objectKey: string
): Promise<void> {
  // Same lock as completePeerDeleteAck: either the ACK finishes first (and its
  // history/staging cleanup is bounded to the old generation) or this clear
  // wins and the late ACK is a no-op.
  await withPeerLock(peerId, () => clearPeerDeletesForNewLandingUnlocked(peerId, objectKey));
}

/**
 * Mark a queued mailbox delete as acknowledged.
 *
 * Runs under the peer lock and only reports success when it actually moved a
 * pending row to `acked`. A new run may reuse the same object key while the
 * friend still has the old delete in flight: `clearPeerDeletesForNewLanding`
 * removes the row first, so a late ACK must not mark history rows removed nor
 * delete the freshly staged object of the new run.
 *
 * Returns false when the delete was already superseded (or acked) — the route
 * treats that as a harmless idempotent retry.
 */
export async function completePeerDeleteAck(
  peerId: string,
  objectKey: string
): Promise<boolean> {
  return withPeerLock(peerId, () => completePeerDeleteAckUnlocked(peerId, objectKey));
}

/** Caller must hold `withPeerLock(peerId)` (the lock is not reentrant). */
export async function completePeerDeleteAckUnlocked(
  peerId: string,
  objectKey: string
): Promise<boolean> {
  const safe = assertSafePeerObjectKey(objectKey);
  {
    const claimed = await db
      .update(peerDeletes)
      .set({ status: 'acked', ackedAt: new Date() })
      .where(
        and(
          eq(peerDeletes.peerId, peerId),
          eq(peerDeletes.objectKey, safe),
          eq(peerDeletes.status, 'pending')
        )
      )
      .returning({ id: peerDeletes.id });
    if (claimed.length === 0) return false;
    await markPeerArtifactRemoved(peerId, safe);
    await deleteStagedObject(peerId, safe);
    return true;
  }
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
    // Never delete the version this run just landed, even if its name sorts
    // older than pre-existing folders (clock jump / future-dated copies).
    const currentKey = options.extraObjects?.[0]?.key;
    const currentRel = currentKey
      ? relativeKeyUnderPrefix(currentKey, prefix)
      : null;
    const currentVersion =
      currentRel && currentRel.includes('/')
        ? currentRel.slice(0, currentRel.indexOf('/'))
        : null;
    if (currentVersion) {
      selected = selected.filter((key) => {
        const rel = relativeKeyUnderPrefix(key, prefix);
        return !rel || !rel.startsWith(`${currentVersion}/`);
      });
    }
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

/**
 * Queue a deletion for one peer artifact, unless another history row still
 * points at the same object key (non-versioned destinations share keys).
 */
async function queuePeerDeleteForArtifact(options: {
  artifactPath: string;
  excludeHistoryId?: string | null;
  excludeConfigId?: string | null;
}): Promise<boolean> {
  const parsed = parsePeerArtifactPath(options.artifactPath);
  if (!parsed) return false;

  const refs = await db.query.backupHistory.findMany({
    where: eq(backupHistory.artifactPath, options.artifactPath),
    columns: { id: true, configId: true, artifactRemoved: true },
  });
  const stillReferenced = refs.some(
    (row) =>
      !row.artifactRemoved &&
      row.id !== options.excludeHistoryId &&
      row.configId !== options.excludeConfigId
  );
  if (stillReferenced) return false;

  const peer = await db.query.peers.findFirst({ where: eq(peers.id, parsed.peerId) });
  if (!peer) return false;

  // An open recall for a disappearing object blocks the mailbox delete; close it.
  await expireRecallsForObject(parsed.peerId, parsed.objectKey);

  if (peer.transport === 'direct') {
    if (peer.status !== 'active') return false;
    try {
      await deletePeerObject(peer, parsed.objectKey);
      await markPeerArtifactRemoved(parsed.peerId, parsed.objectKey);
      return true;
    } catch (error) {
      console.warn(
        `[peer-retention] direct delete ${parsed.objectKey}:`,
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  await enqueueMailboxDeletes(parsed.peerId, [parsed.objectKey]);
  return true;
}

/** History row deleted by the user: free its object on the friend's disk. */
export async function enqueuePeerDeleteForHistory(row: {
  id: string;
  artifactPath: string | null;
  artifactRemoved?: boolean | null;
}): Promise<boolean> {
  if (!row.artifactPath || row.artifactRemoved) return false;
  return queuePeerDeleteForArtifact({
    artifactPath: row.artifactPath,
    excludeHistoryId: row.id,
  });
}

/** Backup config deleted by the user: free every object its runs left on peers. */
export async function enqueuePeerDeletesForConfig(configId: string): Promise<number> {
  const rows = await db.query.backupHistory.findMany({
    where: eq(backupHistory.configId, configId),
    columns: { artifactPath: true, artifactRemoved: true },
  });
  const seen = new Set<string>();
  let queued = 0;
  for (const row of rows) {
    if (!row.artifactPath || row.artifactRemoved) continue;
    if (seen.has(row.artifactPath)) continue;
    seen.add(row.artifactPath);
    const didQueue = await queuePeerDeleteForArtifact({
      artifactPath: row.artifactPath,
      excludeConfigId: configId,
    });
    if (didQueue) queued += 1;
  }
  return queued;
}
