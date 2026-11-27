import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  PeerLockQueueFullError,
  peerLockQueueMax,
  PEER_LOCK_QUEUE_MAX_DEFAULT,
  withPeerLock,
} from './peer-lock';
import { appendRecallChunk } from './recall-chunk';
import { publicUploadErrorMessage } from './upload-errors';

const cleanup: string[] = [];
const ORIGINAL_QUEUE_MAX = process.env.PEER_LOCK_QUEUE_MAX;

afterEach(async () => {
  if (ORIGINAL_QUEUE_MAX === undefined) delete process.env.PEER_LOCK_QUEUE_MAX;
  else process.env.PEER_LOCK_QUEUE_MAX = ORIGINAL_QUEUE_MAX;
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe('appendRecallChunk streaming', () => {
  test('appended 5 MB chunk is byte-identical to a buffered append', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-stream-'));
    cleanup.push(dir);

    const head = Buffer.alloc(64 * 1024, 1);
    const chunk = Buffer.alloc(5 * 1024 * 1024);
    for (let i = 0; i < chunk.length; i += 1) chunk[i] = i % 251;

    const chunk0 = path.join(dir, 'c0');
    const chunk1 = path.join(dir, 'c1');
    const streamed = path.join(dir, 'streamed.part');
    const buffered = path.join(dir, 'buffered.part');
    await fs.writeFile(chunk0, head);
    await fs.writeFile(chunk1, chunk);

    await appendRecallChunk({
      partialPath: streamed,
      chunkIndex: 0,
      expectedOffset: 0,
      chunkPath: chunk0,
      expectedChunkBytes: head.length,
    });
    await appendRecallChunk({
      partialPath: streamed,
      chunkIndex: 1,
      expectedOffset: head.length,
      chunkPath: chunk1,
      expectedChunkBytes: chunk.length,
    });

    // Reference: exactly what the old implementation produced.
    await fs.writeFile(buffered, head);
    await fs.appendFile(buffered, await fs.readFile(chunk1));

    const streamedBytes = await fs.readFile(streamed);
    expect(streamedBytes.length).toBe(head.length + chunk.length);
    expect(streamedBytes.equals(await fs.readFile(buffered))).toBe(true);
  });

  test('does not read the chunk into a Buffer', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-readfile-'));
    cleanup.push(dir);
    const chunk0 = path.join(dir, 'c0');
    const chunk1 = path.join(dir, 'c1');
    const partial = path.join(dir, 'upload.part');
    await fs.writeFile(chunk0, Buffer.alloc(1024, 2));
    await fs.writeFile(chunk1, Buffer.alloc(3 * 1024 * 1024, 3));

    const originalReadFile = fs.readFile.bind(fs);
    let readFileCalls = 0;
    const readFileSpy = ((...args: Parameters<typeof fs.readFile>) => {
      readFileCalls += 1;
      return originalReadFile(...args);
    }) as typeof fs.readFile;
    Object.assign(fs, { readFile: readFileSpy });
    try {
      await appendRecallChunk({
        partialPath: partial,
        chunkIndex: 0,
        expectedOffset: 0,
        chunkPath: chunk0,
        expectedChunkBytes: 1024,
      });
      await appendRecallChunk({
        partialPath: partial,
        chunkIndex: 1,
        expectedOffset: 1024,
        chunkPath: chunk1,
        expectedChunkBytes: 3 * 1024 * 1024,
      });
    } finally {
      Object.assign(fs, { readFile: originalReadFile });
    }
    expect(readFileCalls).toBe(0);
    expect((await fs.stat(partial)).size).toBe(1024 + 3 * 1024 * 1024);
  });
});

describe('withPeerLock queue bound', () => {
  test('refuses the 9th caller immediately and still runs the 8 in FIFO order', async () => {
    process.env.PEER_LOCK_QUEUE_MAX = '8';
    const peerId = 'peer-queue-limit';
    const order: number[] = [];
    let running = 0;
    let maxRunning = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const accepted: Promise<number>[] = [];
    for (let index = 0; index < 8; index += 1) {
      accepted.push(
        withPeerLock(peerId, async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          order.push(index);
          if (index === 0) await firstGate;
          running -= 1;
          return index;
        })
      );
    }

    let refused: unknown = null;
    const ninth = await withPeerLock(peerId, async () => 99).catch((error) => {
      refused = error;
      return -1;
    });
    expect(refused).toBeInstanceOf(PeerLockQueueFullError);
    expect((refused as PeerLockQueueFullError).status).toBe(429);
    expect((refused as Error).message).toMatch(/busy.*queue is full/i);
    // The peer routes use this mapper: keep the 429 instead of a generic 400.
    expect(publicUploadErrorMessage(refused)).toEqual({
      status: 429,
      message: expect.stringContaining('queue is full'),
    });

    releaseFirst();
    expect(await Promise.all(accepted)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ninth).toBe(-1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBe(1);
  });

  test('recovers after the queue drains and isolates peers', async () => {
    process.env.PEER_LOCK_QUEUE_MAX = '2';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = [
      withPeerLock('peer-drain-a', async () => gate),
      withPeerLock('peer-drain-a', async () => undefined),
    ];
    await expect(withPeerLock('peer-drain-a', async () => undefined)).rejects.toBeInstanceOf(
      PeerLockQueueFullError
    );
    // A different peer has its own budget.
    await expect(withPeerLock('peer-drain-b', async () => 'fine')).resolves.toBe('fine');

    release();
    await Promise.all(held);
    await expect(withPeerLock('peer-drain-a', async () => 'recovered')).resolves.toBe('recovered');
  });

  test('reads PEER_LOCK_QUEUE_MAX and falls back to 8 on bad values', () => {
    process.env.PEER_LOCK_QUEUE_MAX = '3';
    expect(peerLockQueueMax()).toBe(3);
    process.env.PEER_LOCK_QUEUE_MAX = '0';
    expect(peerLockQueueMax()).toBe(PEER_LOCK_QUEUE_MAX_DEFAULT);
    expect(PEER_LOCK_QUEUE_MAX_DEFAULT).toBe(8);
    process.env.PEER_LOCK_QUEUE_MAX = 'many';
    expect(peerLockQueueMax()).toBe(8);
    delete process.env.PEER_LOCK_QUEUE_MAX;
    expect(peerLockQueueMax()).toBe(8);
  });
});
