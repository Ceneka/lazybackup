import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-delete-'));
process.env.BACKUP_STORAGE_PATH = tmp;

const client = createClient({ url: `file:${path.join(tmp, 'delete.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

await client.execute(`
  CREATE TABLE peers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    remote_base_url TEXT NOT NULL DEFAULT '',
    remote_peer_id TEXT,
    outbound_token TEXT,
    inbound_token_hash TEXT NOT NULL,
    inbound_token_prefix TEXT NOT NULL,
    quota_bytes INTEGER NOT NULL,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    transport TEXT NOT NULL DEFAULT 'mailbox',
    status TEXT NOT NULL DEFAULT 'active',
    last_seen_at INTEGER,
    last_activity_at INTEGER,
    remote_used_bytes INTEGER,
    remote_quota_bytes INTEGER,
    remote_last_error TEXT,
    remote_last_sync_at INTEGER,
    remote_app_version TEXT,
    remote_reported_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    config_id TEXT NOT NULL,
    artifact_path TEXT,
    artifact_removed INTEGER NOT NULL DEFAULT 0,
    artifact_removed_reason TEXT,
    config_snapshot TEXT,
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
await client.execute(`
  CREATE TABLE peer_recalls (
    id TEXT PRIMARY KEY NOT NULL,
    peer_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  )
`);

const { enqueuePeerDeleteForHistory, enqueuePeerDeletesForConfig, completePeerDeleteAck } = await import(
  './retention'
);
const { landLocalFileArtifact } = await import('@/lib/backup/land-file');

const PEER = {
  id: 'p1',
  name: 'Friend',
  remoteBaseUrl: '',
  remotePeerId: 'remote',
  outboundToken: null,
  inboundTokenHash: 'hash',
  inboundTokenPrefix: 'lbpeer_x…',
  quotaBytes: 1024,
  usedBytes: 0,
  transport: 'mailbox',
  status: 'active',
};

async function insertPeer() {
  await testDb.insert(schema.peers).values({
    ...PEER,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function insertHistory(
  id: string,
  configId: string,
  artifactPath: string,
  artifactRemoved = false
) {
  await client.execute({
    sql: 'INSERT INTO backup_history (id, config_id, artifact_path, artifact_removed) VALUES (?, ?, ?, ?)',
    args: [id, configId, artifactPath, artifactRemoved ? 1 : 0],
  });
}

beforeEach(async () => {
  for (const table of ['peers', 'backup_history', 'peer_deletes', 'peer_recalls']) {
    await client.execute(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('history delete queues peer deletes', () => {
  test('queues the object key when no other run references it', async () => {
    await insertPeer();
    const artifact = 'peer://p1/backups/cfg/app.tar.gz.age';
    await insertHistory('h1', 'cfg1', artifact);

    const queued = await enqueuePeerDeleteForHistory({
      id: 'h1',
      artifactPath: artifact,
      artifactRemoved: false,
    });

    expect(queued).toBe(true);
    const deletes = await testDb.select().from(schema.peerDeletes);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({
      peerId: 'p1',
      objectKey: 'backups/cfg/app.tar.gz.age',
      status: 'pending',
    });
  });

  test('keeps the object when another history row still references the key', async () => {
    await insertPeer();
    const artifact = 'peer://p1/backups/cfg/app.tar.gz.age';
    await insertHistory('h1', 'cfg1', artifact);
    await insertHistory('h2', 'cfg1', artifact);

    const queued = await enqueuePeerDeleteForHistory({
      id: 'h1',
      artifactPath: artifact,
      artifactRemoved: false,
    });

    expect(queued).toBe(false);
    expect(await testDb.select().from(schema.peerDeletes)).toHaveLength(0);
  });

  test('ignores non-peer artifacts and already removed rows', async () => {
    await insertPeer();
    await insertHistory('h1', 'cfg1', '/backups/local/app.tar.gz');
    expect(
      await enqueuePeerDeleteForHistory({
        id: 'h1',
        artifactPath: '/backups/local/app.tar.gz',
      })
    ).toBe(false);

    const artifact = 'peer://p1/backups/cfg/app.tar.gz.age';
    await insertHistory('h2', 'cfg1', artifact, true);
    expect(
      await enqueuePeerDeleteForHistory({
        id: 'h2',
        artifactPath: artifact,
        artifactRemoved: true,
      })
    ).toBe(false);
    expect(await testDb.select().from(schema.peerDeletes)).toHaveLength(0);
  });
});

describe('a new run reusing a non-versioned object key', () => {
  test('clears a queued delete before staging so a late ACK cannot unlink the new artifact', async () => {
    await insertPeer();
    const peer = await testDb.query.peers.findFirst();
    if (!peer) throw new Error('peer fixture missing');

    await testDb.insert(schema.peerDeletes).values({
      id: 'delete-old',
      peerId: 'p1',
      objectKey: 'backups/cfg/app.tar.gz.age',
      status: 'pending',
      createdAt: new Date(),
    });

    const src = path.join(tmp, 'app.tar.gz.age');
    await fs.writeFile(src, Buffer.from('new ciphertext'));

    await landLocalFileArtifact({
      localFilePath: src,
      archiveName: 'app.tar.gz.age',
      destinationKind: 'peer',
      destinationPeer: peer,
      peerPrefix: 'backups/cfg',
    });

    // The landing cleared the stale delete generation before the bytes existed.
    expect(await testDb.select().from(schema.peerDeletes)).toHaveLength(0);
    const staged = path.join(tmp, 'peers-staging', 'p1', 'backups/cfg/app.tar.gz.age');
    expect(await fs.stat(staged)).toBeTruthy();

    // A friend that fetched /work before the landing ACKs late: no-op.
    const acked = await completePeerDeleteAck('p1', 'backups/cfg/app.tar.gz.age');
    expect(acked).toBe(false);
    expect(await fs.stat(staged)).toBeTruthy();
  });
});

describe('config delete queues peer deletes', () => {
  test('queues each unique artifact once and skips keys used by other configs', async () => {
    await insertPeer();
    await insertHistory('h1', 'cfg1', 'peer://p1/backups/cfg1/a.tar.gz.age');
    await insertHistory('h2', 'cfg1', 'peer://p1/backups/cfg1/a.tar.gz.age');
    await insertHistory('h3', 'cfg1', 'peer://p1/backups/cfg1/b.tar.gz.age');
    await insertHistory('h4', 'cfg2', 'peer://p1/backups/shared/c.tar.gz.age');
    await insertHistory('h5', 'cfg1', 'peer://p1/backups/shared/c.tar.gz.age');

    const queued = await enqueuePeerDeletesForConfig('cfg1');

    expect(queued).toBe(2);
    const deletes = await testDb.select().from(schema.peerDeletes);
    expect(deletes.map((row) => row.objectKey).sort()).toEqual([
      'backups/cfg1/a.tar.gz.age',
      'backups/cfg1/b.tar.gz.age',
    ]);
  });
});
