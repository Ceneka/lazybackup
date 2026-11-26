import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

let recallRow: Record<string, unknown> | null = null;
const updates: Array<Record<string, unknown>> = [];

mock.module('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    query: {
      peerRecalls: { findFirst: async () => recallRow },
      backupHistory: { findFirst: async () => null },
    },
  },
}));

const { ingestRecallUpload, recallSpoolPath } = await import('./recall');
const { writePeerObject } = await import('./storage');

describe('recall upload quota accounting', () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(async () => {
    prev = process.env.BACKUP_STORAGE_PATH;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-quota-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    updates.length = 0;
    recallRow = {
      id: 'r1',
      peerId: 'p1',
      objectKey: 'restore.bin',
      historyId: null,
      status: 'uploading',
      error: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      readyAt: null,
      consumedAt: null,
    };
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('accepts a recall even when the peer already stores most of the quota', async () => {
    // Inbound objects already fill 8 of 16 bytes: this is the data the remote
    // peer stores on this host. A recall spool is transient and must not be
    // counted against the same quota, otherwise restores fail when nearing it.
    await writePeerObject('p1', 'existing.bin', Buffer.alloc(8, 1), 16);

    const body = Readable.toWeb(
      Readable.from(Buffer.alloc(12, 2))
    ) as ReadableStream<Uint8Array>;
    const result = await ingestRecallUpload({
      recallId: 'r1',
      peerId: 'p1',
      quotaBytes: 16,
      declaredBytes: 12,
      body,
    });

    expect(result.size).toBe(12);
    const spool = await fs.stat(recallSpoolPath('p1', 'r1'));
    expect(spool.size).toBe(12);
    expect(updates.some((u) => u.status === 'ready')).toBe(true);
  });
});
