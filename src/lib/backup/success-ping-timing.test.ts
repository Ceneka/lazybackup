import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { backupHistory } from '@/lib/db/schema';
import {
  clearPendingForArtifact,
  reconcileDeliveryAfterSuccess,
} from './mailbox-reconcile';

const client = createClient({ url: ':memory:' });
const testDb = drizzle(client, { schema: { backupHistory } });
const pings: string[] = [];

const ARTIFACT = 'peer://peer1/backups/a.age';
const notify = (historyId: string) => {
  pings.push(historyId);
};

async function historyRow() {
  const rows = await testDb
    .select()
    .from(backupHistory)
    .where(eq(backupHistory.id, 'h1'));
  return rows[0];
}

let storageTmp: string;
let prevStorage: string | undefined;

describe('success ping timing for peer deliveries', () => {
  beforeEach(async () => {
    pings.length = 0;
    prevStorage = process.env.BACKUP_STORAGE_PATH;
    storageTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-ping-timing-'));
    process.env.BACKUP_STORAGE_PATH = storageTmp;

    await client.execute(`
      CREATE TABLE IF NOT EXISTS backup_history (
        id TEXT PRIMARY KEY NOT NULL,
        config_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL,
        file_count INTEGER,
        total_size INTEGER,
        transferred_size INTEGER,
        error_message TEXT,
        log_output TEXT,
        artifact_path TEXT,
        artifact_sha256 TEXT,
        mailbox_pending INTEGER NOT NULL DEFAULT 0,
        artifact_removed INTEGER NOT NULL DEFAULT 0,
        artifact_removed_reason TEXT,
        config_snapshot TEXT
      )
    `);
    await client.execute(`DELETE FROM backup_history`);
    await client.execute(
      `INSERT INTO backup_history (id, config_id, start_time, status, mailbox_pending)
       VALUES ('h1', 'cfg1', unixepoch(), 'running', 0)`
    );
  });

  afterEach(async () => {
    if (prevStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prevStorage;
    await fs.rm(storageTmp, { recursive: true, force: true });
  });

  async function stageObject() {
    const file = path.join(storageTmp, 'peers-staging', 'peer1', 'backups', 'a.age');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from('ciphertext'));
  }

  async function writeSuccessRow(mailboxPending: boolean) {
    await testDb
      .update(backupHistory)
      .set({ artifactPath: ARTIFACT, mailboxPending })
      .where(eq(backupHistory.id, 'h1'));
  }

  test('defers the success ping while the object is only staged', async () => {
    await stageObject();
    await writeSuccessRow(true);

    const stillPending = await reconcileDeliveryAfterSuccess({
      executor: testDb,
      historyId: 'h1',
      configId: 'cfg1',
      artifactPath: ARTIFACT,
      mailboxPending: true,
      notifyDelivered: notify,
    });

    expect(stillPending).toBe(true);
    expect(pings).toEqual([]);
    expect((await historyRow())?.mailboxPending).toBe(true);
  });

  test('fires exactly once when the ACK lands', async () => {
    await stageObject();
    await writeSuccessRow(true);

    const cleared = await clearPendingForArtifact({
      executor: testDb,
      artifactPath: ARTIFACT,
      notifyDelivered: notify,
    });
    expect(cleared).toBe(1);
    expect(pings).toEqual(['h1']);
    expect((await historyRow())?.mailboxPending).toBe(false);

    // A duplicate ACK must not ping again.
    expect(
      await clearPendingForArtifact({
        executor: testDb,
        artifactPath: ARTIFACT,
        notifyDelivered: notify,
      })
    ).toBe(0);
    expect(pings).toEqual(['h1']);
  });

  test('race: ACK before the success row exists still fires once and clears pending', async () => {
    await writeSuccessRow(true);
    // No staged file: the friend already pulled + ACKed.

    const stillPending = await reconcileDeliveryAfterSuccess({
      executor: testDb,
      historyId: 'h1',
      configId: 'cfg1',
      artifactPath: ARTIFACT,
      mailboxPending: true,
      notifyDelivered: notify,
    });

    expect(stillPending).toBe(false);
    expect(pings).toEqual(['h1']);
    expect((await historyRow())?.mailboxPending).toBe(false);
  });

  test('race: overlapping ACK and success reconciliation fire exactly once', async () => {
    await stageObject();
    await writeSuccessRow(true);
    // The object vanished between the success write and the staged check,
    // while the ACK handler runs concurrently.
    await fs.rm(path.join(storageTmp, 'peers-staging', 'peer1', 'backups', 'a.age'));

    await Promise.all([
      reconcileDeliveryAfterSuccess({
        executor: testDb,
        historyId: 'h1',
        configId: 'cfg1',
        artifactPath: ARTIFACT,
        mailboxPending: true,
        notifyDelivered: notify,
      }),
      clearPendingForArtifact({
        executor: testDb,
        artifactPath: ARTIFACT,
        notifyDelivered: notify,
      }),
    ]);

    expect(pings).toEqual(['h1']);
    expect((await historyRow())?.mailboxPending).toBe(false);
  });

  test('non-peer success pings immediately', async () => {
    const stillPending = await reconcileDeliveryAfterSuccess({
      executor: testDb,
      historyId: 'h1',
      configId: 'cfg1',
      artifactPath: '/backups/a.age',
      mailboxPending: false,
      notifyDelivered: notify,
    });

    expect(stillPending).toBe(false);
    expect(pings).toEqual(['h1']);
  });
});
