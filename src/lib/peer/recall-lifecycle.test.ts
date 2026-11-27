import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-lifecycle-'));
const prevBackupStorage = process.env.BACKUP_STORAGE_PATH;
process.env.BACKUP_STORAGE_PATH = tmp;

const client = createClient({ url: `file:${path.join(tmp, 'recall.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

await client.execute(`
  CREATE TABLE peer_recalls (
    id TEXT PRIMARY KEY NOT NULL,
    peer_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    history_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ready_at INTEGER,
    consumed_at INTEGER
  )
`);
await client.execute(`
  CREATE TABLE peer_deletes (
    id TEXT PRIMARY KEY NOT NULL,
    peer_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    acked_at INTEGER
  )
`);
await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_path TEXT,
    artifact_removed INTEGER NOT NULL DEFAULT 0
  )
`);

// A fresh module instance bypasses any `./recall` mock left by an earlier file.
const {
  ensureRecall,
  expireRecallsForObject,
  expireStaleRecalls,
  PeerRecallBlockedError,
  PeerRecallFailedError,
  recallSpoolPath,
} = (await import(`./recall.ts?recall-lifecycle=${Date.now()}`)) as typeof import('./recall');

async function insertRecall(values: Partial<typeof schema.peerRecalls.$inferInsert> & {
  id: string;
  peerId: string;
  objectKey: string;
}) {
  await testDb.insert(schema.peerRecalls).values({
    status: 'pending',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    ...values,
  });
}

async function spool(peerId: string, recallId: string, bytes = 4) {
  const file = recallSpoolPath(peerId, recallId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.alloc(bytes, 7));
  return file;
}

beforeEach(async () => {
  await client.execute('DELETE FROM peer_recalls');
  await client.execute('DELETE FROM peer_deletes');
  await client.execute('DELETE FROM backup_history');
  await fs.rm(path.join(tmp, 'peers-recall'), { recursive: true, force: true });
});

afterAll(async () => {
  if (prevBackupStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
  else process.env.BACKUP_STORAGE_PATH = prevBackupStorage;
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('recall expiry', () => {
  test('expires and unlinks ready spools after the TTL', async () => {
    await insertRecall({
      id: 'r-old',
      peerId: 'p1',
      objectKey: 'old.age',
      status: 'ready',
      expiresAt: new Date(Date.now() - 1000),
    });
    await insertRecall({
      id: 'r-live',
      peerId: 'p1',
      objectKey: 'live.age',
      status: 'ready',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const oldFile = await spool('p1', 'r-old');
    const liveFile = await spool('p1', 'r-live');

    await expireStaleRecalls();

    const oldRow = await testDb.query.peerRecalls.findFirst({
      where: (row, { eq }) => eq(row.id, 'r-old'),
    });
    const liveRow = await testDb.query.peerRecalls.findFirst({
      where: (row, { eq }) => eq(row.id, 'r-live'),
    });
    expect(oldRow?.status).toBe('expired');
    expect(liveRow?.status).toBe('ready');
    expect(await fs.stat(path.dirname(oldFile)).catch(() => null)).toBeNull();
    expect(await fs.stat(liveFile).catch(() => null)).not.toBeNull();
  });

  test('closes open recalls for an object that is being deleted', async () => {
    await insertRecall({
      id: 'r-del',
      peerId: 'p1',
      objectKey: 'gone.age',
      status: 'ready',
    });
    const file = await spool('p1', 'r-del');

    await expireRecallsForObject('p1', 'gone.age');

    const row = await testDb.query.peerRecalls.findFirst({
      where: (recall, { eq }) => eq(recall.id, 'r-del'),
    });
    expect(row?.status).toBe('expired');
    expect(await fs.stat(path.dirname(file)).catch(() => null)).toBeNull();
  });
});

describe('ensureRecall failure surfacing', () => {
  test('returns the failed-recall error instead of silently 202-ing', async () => {
    await insertRecall({
      id: 'r-failed',
      peerId: 'p1',
      objectKey: 'restore.bin',
      historyId: 'h1',
      status: 'failed',
      error: 'recall artifact SHA-256 mismatch: expected aa, got bb',
    });

    let caught: unknown = null;
    try {
      await ensureRecall({ peerId: 'p1', objectKey: 'restore.bin', historyId: 'h1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PeerRecallFailedError);
    expect((caught as Error).message).toContain('SHA-256 mismatch');
    expect((caught as Error).message).toContain('Retry');
  });

  test('an explicit retry drops the failed recall and starts a new one', async () => {
    await insertRecall({
      id: 'r-failed-2',
      peerId: 'p1',
      objectKey: 'restore.bin',
      historyId: 'h2',
      status: 'failed',
      error: 'digest mismatch',
    });

    const recall = await ensureRecall({
      peerId: 'p1',
      objectKey: 'restore.bin',
      historyId: 'h2',
      retry: true,
    });
    expect(recall.status).toBe('pending');
    const rows = await testDb.select().from(schema.peerRecalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(recall.id);
  });

  test('refuses a recall when the object has a queued or acked delete', async () => {
    await testDb.insert(schema.peerDeletes).values({
      id: 'd1',
      peerId: 'p1',
      objectKey: 'restore.bin',
      status: 'pending',
      createdAt: new Date(),
    });

    let pendingError: unknown = null;
    try {
      await ensureRecall({ peerId: 'p1', objectKey: 'restore.bin' });
    } catch (error) {
      pendingError = error;
    }
    expect(pendingError).toBeInstanceOf(PeerRecallBlockedError);
    expect((pendingError as Error).message).toMatch(/queued for deletion/i);

    await client.execute("UPDATE peer_deletes SET status = 'acked' WHERE id = 'd1'");
    await expect(
      ensureRecall({ peerId: 'p1', objectKey: 'restore.bin' })
    ).rejects.toThrow(/deleted from/i);

    // A newer run re-landed the same key: the old acked delete is stale.
    await client.execute(
      "INSERT INTO backup_history (id, artifact_path, artifact_removed) VALUES ('h-live', 'peer://p1/restore.bin', 0)"
    );
    const recall = await ensureRecall({ peerId: 'p1', objectKey: 'restore.bin' });
    expect(recall.status).toBe('pending');
    expect(await testDb.select().from(schema.peerDeletes)).toHaveLength(0);
  });
});
