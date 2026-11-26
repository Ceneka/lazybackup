import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { sha256Buffer } from './digest';
import { PEER_RECALL_CHUNK_MAX_BYTES } from './recall-chunk';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

type RecallRow = {
  id: string;
  peerId: string;
  objectKey: string;
  historyId: string | null;
  status: string;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
  readyAt: Date | null;
  consumedAt: Date | null;
};

let recallRow: RecallRow | null = null;
let expectedSha: string | null = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      peerRecalls: {
        findFirst: async () => recallRow,
      },
      backupHistory: {
        findFirst: async () => (expectedSha ? { artifactSha256: expectedSha } : null),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (recallRow && typeof values.status === 'string') {
            recallRow = { ...recallRow, ...(values as Partial<RecallRow>) };
          }
        },
      }),
    }),
  },
}));

const { ingestRecallChunk, recallPartialPath, recallSpoolPath } = (await import(
  `./recall.ts?recall-chunk-host=${Date.now()}`
)) as typeof import('./recall');
const { PeerUploadLimitError } = await import('./upload-limit');

function stream(bytes: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(bytes)) as ReadableStream<Uint8Array>;
}

function newRecall(id: string): RecallRow {
  return {
    id,
    peerId: 'p1',
    objectKey: 'restore.bin',
    historyId: null,
    status: 'uploading',
    error: null,
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    readyAt: null,
    consumedAt: null,
  };
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-chunk-host-'));
let prevStorage: string | undefined;

beforeEach(() => {
  prevStorage = process.env.BACKUP_STORAGE_PATH;
  process.env.BACKUP_STORAGE_PATH = tmpRoot;
  expectedSha = null;
});

afterEach(async () => {
  if (prevStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
  else process.env.BACKUP_STORAGE_PATH = prevStorage;
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('chunked recall host assembly', () => {
  test('appends chunks in order and finalizes with the SHA-256 check', async () => {
    const total = PEER_RECALL_CHUNK_MAX_BYTES * 2 + 1024;
    const artifact = Buffer.alloc(total);
    for (let i = 0; i < total; i++) artifact[i] = i % 251;
    const chunks = [
      artifact.subarray(0, PEER_RECALL_CHUNK_MAX_BYTES),
      artifact.subarray(PEER_RECALL_CHUNK_MAX_BYTES, PEER_RECALL_CHUNK_MAX_BYTES * 2),
      artifact.subarray(PEER_RECALL_CHUNK_MAX_BYTES * 2),
    ];
    recallRow = newRecall('r1');
    expectedSha = sha256Buffer(artifact);

    const first = await ingestRecallChunk({
      recallId: 'r1',
      peerId: 'p1',
      quotaBytes: total * 2,
      chunkIndex: 0,
      chunkCount: 3,
      totalBytes: total,
      declaredBytes: chunks[0]!.length,
      body: stream(chunks[0]!),
    });
    expect(first.done).toBe(false);
    expect(first.receivedBytes).toBe(chunks[0]!.length);

    const second = await ingestRecallChunk({
      recallId: 'r1',
      peerId: 'p1',
      quotaBytes: total * 2,
      chunkIndex: 1,
      chunkCount: 3,
      totalBytes: total,
      declaredBytes: chunks[1]!.length,
      body: stream(chunks[1]!),
    });
    expect(second.done).toBe(false);

    const last = await ingestRecallChunk({
      recallId: 'r1',
      peerId: 'p1',
      quotaBytes: total * 2,
      chunkIndex: 2,
      chunkCount: 3,
      totalBytes: total,
      declaredBytes: chunks[2]!.length,
      body: stream(chunks[2]!),
    });
    expect(last.done).toBe(true);
    expect(last.size).toBe(total);
    expect(last.sha256).toBe(expectedSha);

    const spool = await fs.readFile(recallSpoolPath('p1', 'r1'));
    expect(spool.equals(artifact)).toBe(true);
    expect(recallRow?.status).toBe('ready');
    expect(
      await fs.stat(recallPartialPath('p1', 'r1')).catch(() => null)
    ).toBeNull();
  });

  test('rejects an out-of-order chunk and can restart from chunk 0', async () => {
    recallRow = newRecall('r2');
    const total = PEER_RECALL_CHUNK_MAX_BYTES + 32;
    const tail = Buffer.alloc(32, 1);
    await expect(
      ingestRecallChunk({
        recallId: 'r2',
        peerId: 'p1',
        quotaBytes: total * 2,
        chunkIndex: 1,
        chunkCount: 2,
        totalBytes: total,
        declaredBytes: tail.length,
        body: stream(tail),
      })
    ).rejects.toThrow(/out of order/i);

    const first = await ingestRecallChunk({
      recallId: 'r2',
      peerId: 'p1',
      quotaBytes: total * 2,
      chunkIndex: 0,
      chunkCount: 2,
      totalBytes: total,
      declaredBytes: PEER_RECALL_CHUNK_MAX_BYTES,
      body: stream(Buffer.alloc(PEER_RECALL_CHUNK_MAX_BYTES, 1)),
    });
    expect(first.done).toBe(false);
  });

  test('surfaces a digest mismatch as a failed recall and removes the partial', async () => {
    recallRow = newRecall('r3');
    expectedSha = 'a'.repeat(64);
    const chunk = Buffer.alloc(16, 2);
    await expect(
      ingestRecallChunk({
        recallId: 'r3',
        peerId: 'p1',
        quotaBytes: 1024,
        chunkIndex: 0,
        chunkCount: 1,
        totalBytes: 16,
        declaredBytes: 16,
        body: stream(chunk),
      })
    ).rejects.toThrow(/SHA-256 mismatch/i);
    expect(recallRow?.status).toBe('failed');
    expect(
      await fs.stat(path.dirname(recallPartialPath('p1', 'r3'))).catch(() => null)
    ).toBeNull();
  });

  test('rejects a total larger than the peer quota with 413', async () => {
    recallRow = newRecall('r4');
    let caught: unknown = null;
    try {
      await ingestRecallChunk({
        recallId: 'r4',
        peerId: 'p1',
        quotaBytes: 8,
        chunkIndex: 0,
        chunkCount: 1,
        totalBytes: 16,
        declaredBytes: 16,
        body: stream(Buffer.alloc(16)),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PeerUploadLimitError);
    expect((caught as InstanceType<typeof PeerUploadLimitError>).status).toBe(413);
    expect((caught as Error).message).toMatch(/exceeds maximum/i);
  });
});
