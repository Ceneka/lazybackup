import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide, so this file avoids mocking @/lib/db for
// the persistence tests: the helpers take an executor. Only the last test needs
// a route bound to a fixture, and it re-imports the route fresh for that reason.

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-delivery-error-'));
const client = createClient({ url: `file:${path.join(tmp, 'delivery.db')}` });
const testDb = drizzle(client, { schema });

await client.execute(`
  CREATE TABLE peers (
    id TEXT PRIMARY KEY NOT NULL,
    remote_used_bytes INTEGER,
    remote_quota_bytes INTEGER,
    remote_last_error TEXT,
    remote_last_sync_at INTEGER,
    remote_app_version TEXT,
    remote_reported_at INTEGER,
    last_seen_at INTEGER,
    last_activity_at INTEGER,
    updated_at INTEGER
  )
`);
await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    config_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    status TEXT NOT NULL,
    artifact_path TEXT,
    delivery_error TEXT,
    mailbox_pending INTEGER NOT NULL DEFAULT 0,
    artifact_removed INTEGER NOT NULL DEFAULT 0
  )
`);

const { deliveryErrorForHistoryRow, setDeliveryErrorForArtifact } = await import(
  '@/lib/backup/history'
);
const { syncDeliveryErrorsFromReport } = await import('./reports');

const PEER = 'peer_bro';
const ARTIFACT = 'peer://peer_bro/backups/cfg/app.tar.gz.age';
const OTHER_ARTIFACT = 'peer://peer_bro/backups/cfg/other.tar.gz.age';

async function insertHistory(
  id: string,
  artifactPath: string | null,
  deliveryError: string | null = null
) {
  await client.execute({
    sql: `INSERT INTO backup_history (id, config_id, start_time, status, artifact_path, delivery_error)
          VALUES (?, 'cfg1', unixepoch(), 'success', ?, ?)`,
    args: [id, artifactPath, deliveryError],
  });
}

async function deliveryErrorFor(id: string): Promise<string | null> {
  const result = await client.execute({
    sql: 'SELECT delivery_error FROM backup_history WHERE id = ?',
    args: [id],
  });
  return (result.rows[0]?.delivery_error as string | null) ?? null;
}

beforeEach(async () => {
  await client.execute('DELETE FROM peers');
  await client.execute('DELETE FROM backup_history');
});

describe('persist Bro delivery failures', () => {
  test('a failure report writes the reason on the matching artifact only', async () => {
    await insertHistory('h1', ARTIFACT);
    await insertHistory('h2', OTHER_ARTIFACT);
    await insertHistory('p2', 'peer://other_peer/backups/cfg/app.tar.gz.age');

    const updated = await syncDeliveryErrorsFromReport(
      PEER,
      'Pull backups/cfg/app.tar.gz.age: Quota exceeded',
      testDb
    );

    expect(updated).toBe(1);
    expect(await deliveryErrorFor('h1')).toBe(
      'Pull backups/cfg/app.tar.gz.age: Quota exceeded'
    );
    expect(await deliveryErrorFor('h2')).toBeNull();
    // Same object key under a different peer is not this report's failure.
    expect(await deliveryErrorFor('p2')).toBeNull();
  });

  test('a later successful report clears the persisted reason', async () => {
    await insertHistory('h1', ARTIFACT, 'Pull backups/cfg/app.tar.gz.age: HTTP 500');

    await syncDeliveryErrorsFromReport(PEER, null, testDb);

    expect(await deliveryErrorFor('h1')).toBeNull();
  });

  test('an error that names no artifact leaves the persisted reason alone', async () => {
    await insertHistory('h1', ARTIFACT, 'old failure');

    // Transport/offline errors do not name an object key.
    await syncDeliveryErrorsFromReport(PEER, 'Work failed (503)', testDb);
    expect(await deliveryErrorFor('h1')).toBe('old failure');
  });

  test('setDeliveryErrorForArtifact writes, clears, and ignores non-peer paths', async () => {
    await insertHistory('h1', ARTIFACT);

    expect(await setDeliveryErrorForArtifact(ARTIFACT, 'disk full', testDb)).toBe(1);
    expect(await deliveryErrorFor('h1')).toBe('disk full');

    expect(await setDeliveryErrorForArtifact(ARTIFACT, null, testDb)).toBe(1);
    expect(await deliveryErrorFor('h1')).toBeNull();

    // Unknown artifact: nothing to update, no throw.
    expect(
      await setDeliveryErrorForArtifact('peer://peer_bro/backups/cfg/missing.age', 'x', testDb)
    ).toBe(0);
    // Local/S3 paths never carry an off-host delivery reason.
    expect(await setDeliveryErrorForArtifact('/backups/local/app', 'x', testDb)).toBe(0);
  });

  test('read side prefers the persisted reason over the derived one', () => {
    const row = {
      deliveryError: 'Persisted: quota exceeded',
      artifactPath: ARTIFACT,
      backupConfig: {
        destinationPeer: {
          remoteLastError: 'Pull backups/cfg/app.tar.gz.age: derived reason',
        },
      },
    };
    expect(deliveryErrorForHistoryRow(row, 'failed')).toBe('Persisted: quota exceeded');

    // Legacy row (nothing persisted) still derives from the peer report.
    expect(
      deliveryErrorForHistoryRow({ ...row, deliveryError: null }, 'failed')
    ).toBe('Pull backups/cfg/app.tar.gz.age: derived reason');
  });
});

afterAll(() => {
  mock.restore();
});
