import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-superseded-'));
const client = createClient({ url: `file:${path.join(tmp, 'superseded.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    config_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    artifact_path TEXT,
    artifact_removed INTEGER NOT NULL DEFAULT 0,
    artifact_removed_reason TEXT,
    mailbox_pending INTEGER NOT NULL DEFAULT 0
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

const {
  ARTIFACT_SUPERSEDED_MESSAGE,
  assertPeerArtifactRestorable,
  markSupersededPeerHistory,
} = await import('./retention');

const ARTIFACT = 'peer://p1/backups/cfg/app.tar.gz.age';

async function insertHistory(id: string, artifactPath: string, removed = false) {
  await client.execute({
    sql: 'INSERT INTO backup_history (id, config_id, artifact_path, artifact_removed) VALUES (?, ?, ?, ?)',
    args: [id, 'cfg1', artifactPath, removed ? 1 : 0],
  });
}

beforeEach(async () => {
  await client.execute('DELETE FROM backup_history');
  await client.execute('DELETE FROM peer_deletes');
});

afterAll(async () => {
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`@/lib/db?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('non-versioned peer overwrite', () => {
  test('marks older rows superseded with a reason and blocks their restore', async () => {
    await insertHistory('old-run', ARTIFACT);
    await insertHistory('new-run', ARTIFACT);

    const marked = await markSupersededPeerHistory({
      peerId: 'p1',
      objectKey: 'backups/cfg/app.tar.gz.age',
      currentHistoryId: 'new-run',
    });

    expect(marked).toBe(1);
    const oldRow = await client.execute(
      "SELECT artifact_removed, artifact_removed_reason FROM backup_history WHERE id = 'old-run'"
    );
    expect(oldRow.rows[0]?.artifact_removed).toBe(1);
    expect(oldRow.rows[0]?.artifact_removed_reason).toBe(ARTIFACT_SUPERSEDED_MESSAGE);

    await expect(
      assertPeerArtifactRestorable(ARTIFACT, 'old-run')
    ).rejects.toThrow(
      'This backup was replaced by a newer run (versioning is off for this backup)'
    );
    await expect(
      assertPeerArtifactRestorable(ARTIFACT, 'new-run')
    ).resolves.toBeUndefined();
  });

  test('does not touch rows for a different object key', async () => {
    await insertHistory('old-run', ARTIFACT);
    await insertHistory(
      'other-run',
      'peer://p1/backups/cfg/other.tar.gz.age'
    );

    await markSupersededPeerHistory({
      peerId: 'p1',
      objectKey: 'backups/cfg/app.tar.gz.age',
      currentHistoryId: 'new-run',
    });

    const other = await client.execute(
      "SELECT artifact_removed FROM backup_history WHERE id = 'other-run'"
    );
    expect(other.rows[0]?.artifact_removed).toBe(0);
  });
});
