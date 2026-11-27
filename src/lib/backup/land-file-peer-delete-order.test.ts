import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-land-delete-'));
process.env.BACKUP_STORAGE_PATH = tmp;

const client = createClient({ url: `file:${path.join(tmp, 'land-delete.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

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

const { landLocalFileArtifact } = await import('@/lib/backup/land-file');
const { stagedObjectExists } = await import('@/lib/peer/staging');

function peerRow() {
  return {
    id: 'peer_mailbox',
    name: 'Bro',
    remoteBaseUrl: '',
    remotePeerId: 'remote_peer',
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    inboundTokenHash: 'hash',
    inboundTokenPrefix: 'lbpeer_aaa…',
    quotaBytes: 1024,
    usedBytes: 0,
    transport: 'mailbox' as const,
    status: 'active' as const,
    lastSeenAt: null,
    lastActivityAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const KEY = 'backups/config/app.tar.gz.age';

async function pendingDeleteCount(): Promise<number> {
  const rows = await client.execute('SELECT count(*) AS c FROM peer_deletes');
  return Number(rows.rows[0]?.c ?? 0);
}

beforeEach(async () => {
  await client.execute('DELETE FROM peer_deletes');
});

afterAll(async () => {
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('mailbox re-landing clears an obsolete retention delete', () => {
  test('the pending delete is gone before the new object is staged', async () => {
    await client.execute({
      sql: 'INSERT INTO peer_deletes (id, peer_id, object_key, status) VALUES (?, ?, ?, ?)',
      args: ['d1', 'peer_mailbox', KEY, 'pending'],
    });

    const src = path.join(tmp, 'archive.age');
    await fs.writeFile(src, Buffer.from('ciphertext'));

    await landLocalFileArtifact({
      localFilePath: src,
      archiveName: 'app.tar.gz.age',
      destinationKind: 'peer',
      destinationPeer: peerRow() as never,
      peerPrefix: 'backups/config',
      clearStalePeerDeletes: true,
    });

    // If the delete were still queued when the worker synced, it would delete
    // these fresh bytes and ACK them as the old object.
    expect(await pendingDeleteCount()).toBe(0);
    expect(await stagedObjectExists('peer_mailbox', KEY)).toBe(true);
  });
});
