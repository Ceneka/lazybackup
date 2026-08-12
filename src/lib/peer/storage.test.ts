import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

mock.module('@/lib/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
}));

const { assertPeerQuota, ingestPeerObjectUpload, writePeerObject } = await import('./storage');

describe('peer store quota', () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(async () => {
    prev = process.env.BACKUP_STORAGE_PATH;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-store-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('assertPeerQuota rejects when additional bytes exceed remaining quota', async () => {
    const peerId = 'peer_q';
    await writePeerObject(peerId, 'a.bin', Buffer.alloc(8, 1), 16);
    await expect(assertPeerQuota(peerId, 16, 9)).rejects.toThrow(/quota exceeded/i);
  });

  test('ingestPeerObjectUpload enforces declared size and quota under the peer lock', async () => {
    const peerId = 'peer_ingest';
    const body = Buffer.from('abcdefgh'); // 8 bytes
    const stream = Readable.toWeb(Readable.from(body)) as ReadableStream<Uint8Array>;
    const result = await ingestPeerObjectUpload({
      peerId,
      objectKey: 'obj.age',
      quotaBytes: 16,
      declaredBytes: 8,
      body: stream,
    });
    expect(result.size).toBe(8);

    const tooBig = Readable.toWeb(Readable.from(Buffer.alloc(12, 2))) as ReadableStream<Uint8Array>;
    await expect(
      ingestPeerObjectUpload({
        peerId,
        objectKey: 'other.age',
        quotaBytes: 16,
        declaredBytes: 12,
        body: tooBig,
      })
    ).rejects.toThrow(/quota exceeded/i);
  });

  test('serialized concurrent PUTs cannot both exceed quota', async () => {
    const peerId = 'peer_race';
    const quotaBytes = 10;
    const payload = Buffer.alloc(8, 9);

    const run = (key: string) =>
      ingestPeerObjectUpload({
        peerId,
        objectKey: key,
        quotaBytes,
        declaredBytes: payload.byteLength,
        body: Readable.toWeb(Readable.from(payload)) as ReadableStream<Uint8Array>,
      });

    const results = await Promise.allSettled([run('one.age'), run('two.age')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/quota exceeded/i);
  });
});
