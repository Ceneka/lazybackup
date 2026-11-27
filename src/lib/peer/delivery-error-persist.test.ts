import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import { NextRequest } from 'next/server';
import os from 'os';
import path from 'path';
import * as schema from '@/lib/db/schema';

// Bun module mocks are process-wide; drop anything a previous test file left.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-delivery-error-'));
const client = createClient({ url: `file:${path.join(tmp, 'delivery.db')}` });
const testDb = drizzle(client, { schema });
mock.module('@/lib/db', () => ({ db: testDb }));

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
const { recordPeerReport } = await import('./reports');

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

async function insertPeer(id = PEER) {
  await client.execute({ sql: 'INSERT INTO peers (id) VALUES (?)', args: [id] });
}

async function deliveryErrorFor(id: string): Promise<string | null> {
  const result = await client.execute({
    sql: 'SELECT delivery_error FROM backup_history WHERE id = ?',
    args: [id],
  });
  return (result.rows[0]?.delivery_error as string | null) ?? null;
}

async function peerLastError(id = PEER): Promise<string | null> {
  const result = await client.execute({
    sql: 'SELECT remote_last_error FROM peers WHERE id = ?',
    args: [id],
  });
  return (result.rows[0]?.remote_last_error as string | null) ?? null;
}

beforeEach(async () => {
  await client.execute('DELETE FROM peers');
  await client.execute('DELETE FROM backup_history');
});

describe('persist Bro delivery failures', () => {
  test('a failure report writes the reason on the matching artifact only', async () => {
    await insertPeer();
    await insertHistory('h1', ARTIFACT);
    await insertHistory('h2', OTHER_ARTIFACT);
    await insertHistory('p2', 'peer://other_peer/backups/cfg/app.tar.gz.age');

    await recordPeerReport(PEER, {
      lastError: 'Pull backups/cfg/app.tar.gz.age: Quota exceeded',
    });

    expect(await deliveryErrorFor('h1')).toBe(
      'Pull backups/cfg/app.tar.gz.age: Quota exceeded'
    );
    expect(await deliveryErrorFor('h2')).toBeNull();
    // Same object key under a different peer is not this report's failure.
    expect(await deliveryErrorFor('p2')).toBeNull();
    // The soft peer error is still stored for the UI.
    expect(await peerLastError()).toBe('Pull backups/cfg/app.tar.gz.age: Quota exceeded');
  });

  test('a later successful report clears the persisted reason', async () => {
    await insertPeer();
    await insertHistory('h1', ARTIFACT, 'Pull backups/cfg/app.tar.gz.age: HTTP 500');

    await recordPeerReport(PEER, { lastError: null });

    expect(await deliveryErrorFor('h1')).toBeNull();
    expect(await peerLastError()).toBeNull();
  });

  test('an error that names no artifact leaves the persisted reason alone', async () => {
    await insertPeer();
    await insertHistory('h1', ARTIFACT, 'old failure');

    await recordPeerReport(PEER, { lastError: 'Work failed (503)' });
    expect(await deliveryErrorFor('h1')).toBe('old failure');

    // Not sending lastError at all (old client) must not clear either.
    await recordPeerReport(PEER, { appVersion: '1.2.3' });
    expect(await deliveryErrorFor('h1')).toBe('old failure');
  });

  test('setDeliveryErrorForArtifact writes, clears, and ignores non-peer paths', async () => {
    await insertHistory('h1', ARTIFACT);

    expect(await setDeliveryErrorForArtifact(ARTIFACT, 'disk full')).toBe(1);
    expect(await deliveryErrorFor('h1')).toBe('disk full');

    expect(await setDeliveryErrorForArtifact(ARTIFACT, null)).toBe(1);
    expect(await deliveryErrorFor('h1')).toBeNull();

    // Unknown artifact: nothing to update, no throw.
    expect(
      await setDeliveryErrorForArtifact('peer://peer_bro/backups/cfg/missing.age', 'x')
    ).toBe(0);
    // Local/S3 paths never carry an off-host delivery reason.
    expect(await setDeliveryErrorForArtifact('/backups/local/app', 'x')).toBe(0);
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

describe('history API delivery error', () => {
  test('returns the persisted reason with the legacy alias', async () => {
    const fixture = {
      id: 'h1',
      status: 'success',
      mailboxPending: true,
      artifactPath: ARTIFACT,
      configSnapshot: null,
      deliveryError: 'Persisted: quota exceeded',
      backupConfig: {
        id: 'cfg1',
        name: 'App',
        destinationKind: 'peer',
        destinationPath: 'backups/cfg',
        destinationPeer: {
          id: PEER,
          name: 'Bro',
          remoteLastError: 'Pull backups/cfg/app.tar.gz.age: derived reason',
        },
      },
    };
    mock.module('@/lib/db', () => ({
      db: {
        query: {
          backupHistory: {
            findFirst: async () => fixture,
          },
        },
      },
    }));
    const { GET } = await import('@/app/api/history/[id]/route');

    const response = await GET(
      new NextRequest('http://127.0.0.1/api/history/h1'),
      { params: Promise.resolve({ id: 'h1' }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      deliveryState: string | null;
      deliveryError: string | null;
      mailboxError: string | null;
    };
    expect(body.deliveryState).toBe('failed');
    expect(body.deliveryError).toBe('Persisted: quota exceeded');
    expect(body.mailboxError).toBe('Persisted: quota exceeded');
  });
});

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});
