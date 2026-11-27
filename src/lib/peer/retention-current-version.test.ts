import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-retention-current-'));
const prevBackupStorage = process.env.BACKUP_STORAGE_PATH;
process.env.BACKUP_STORAGE_PATH = tmp;

const client = createClient({ url: `file:${path.join(tmp, 'current.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    config_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    file_count INTEGER,
    total_size INTEGER,
    transferred_size INTEGER,
    error_message TEXT,
    log_output TEXT,
    artifact_path TEXT,
    artifact_sha256 TEXT,
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

const { applyPeerDestinationRetention } = await import('./retention');

const PREFIX = 'backups/cfg';
const FUTURE_1 = `${PREFIX}/2030-01-01_00-00-00/old-1.age`;
const FUTURE_2 = `${PREFIX}/2030-01-02_00-00-00/old-2.age`;
const CURRENT = `${PREFIX}/2026-08-07_23-15-03/new.age`;

async function insertSuccess(id: string, key: string, endedAt: Date) {
  await client.execute({
    sql: 'INSERT INTO backup_history (id, config_id, status, start_time, end_time, artifact_path) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      id,
      'cfg1',
      'success',
      Math.floor(endedAt.getTime() / 1000),
      Math.floor(endedAt.getTime() / 1000),
      `peer://p1/${key}`,
    ],
  });
}

beforeEach(async () => {
  await client.execute('DELETE FROM backup_history');
  await client.execute('DELETE FROM peer_deletes');
});

afterAll(async () => {
  if (prevBackupStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
  else process.env.BACKUP_STORAGE_PATH = prevBackupStorage;
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('peer version retention never deletes the current run', () => {
  test('a future-dated folder cannot select the just-landed version', async () => {
    await insertSuccess('h-old-1', FUTURE_1, new Date('2020-01-01T00:00:00Z'));
    await insertSuccess('h-old-2', FUTURE_2, new Date('2020-01-02T00:00:00Z'));
    await insertSuccess('h-current', CURRENT, new Date('2020-01-03T00:00:00Z'));

    const cleaned = await applyPeerDestinationRetention({
      configId: 'cfg1',
      peer: {
        id: 'p1',
        name: 'Friend',
        transport: 'mailbox',
        status: 'active',
      } as never,
      destinationPath: PREFIX,
      enableVersioning: true,
      versionsToKeep: 1,
      // The current run's artifact is what the backup just staged.
      extraObjects: [{ key: CURRENT, mtimeMs: Date.now() }],
    });

    // Only an older future-dated version may be queued; the fresh artifact is
    // never selected, and at least one older copy survives.
    expect(cleaned.keys).toEqual([FUTURE_1]);
    expect(cleaned.keys).not.toContain(CURRENT);
  });
});
