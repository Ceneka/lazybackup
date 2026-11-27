import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  appendRecallChunk,
  PEER_RECALL_CHUNK_MAX_BYTES,
  planRecallChunks,
} from './recall-chunk';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe('planRecallChunks', () => {
  test('covers the whole artifact without gaps', () => {
    const total = 31_470_781;
    const chunks = planRecallChunks(total, PEER_RECALL_CHUNK_MAX_BYTES);
    expect(chunks.length).toBe(8);
    expect(chunks[0]).toMatchObject({ index: 0, start: 0, length: PEER_RECALL_CHUNK_MAX_BYTES });
    let next = 0;
    for (const chunk of chunks) {
      expect(chunk.start).toBe(next);
      next = chunk.end;
    }
    expect(next).toBe(total);
  });

  test('handles exact multiples and rejects invalid values', () => {
    expect(planRecallChunks(8, 4).map((chunk) => chunk.length)).toEqual([4, 4]);
    expect(planRecallChunks(0, 1024)).toEqual([]);
    expect(() => planRecallChunks(-1, 1024)).toThrow();
    expect(() => planRecallChunks(10, 0)).toThrow();
  });
});

describe('appendRecallChunk', () => {
  test('assembles chunks in order and restarts from chunk 0', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-chunk-'));
    cleanup.push(dir);
    const partial = path.join(dir, 'upload.part');
    const chunks = [
      path.join(dir, 'c0'),
      path.join(dir, 'c1'),
      path.join(dir, 'c2'),
    ];
    await fs.writeFile(chunks[0]!, Buffer.from('abcd'));
    await fs.writeFile(chunks[1]!, Buffer.from('efgh'));
    await fs.writeFile(chunks[2]!, Buffer.from('ij'));

    expect(
      await appendRecallChunk({
        partialPath: partial,
        chunkIndex: 0,
        expectedOffset: 0,
        chunkPath: chunks[0]!,
        expectedChunkBytes: 4,
      })
    ).toBe(4);
    expect(
      await appendRecallChunk({
        partialPath: partial,
        chunkIndex: 1,
        expectedOffset: 4,
        chunkPath: chunks[1]!,
        expectedChunkBytes: 4,
      })
    ).toBe(8);
    expect(
      await appendRecallChunk({
        partialPath: partial,
        chunkIndex: 2,
        expectedOffset: 8,
        chunkPath: chunks[2]!,
        expectedChunkBytes: 2,
      })
    ).toBe(10);
    expect(await fs.readFile(partial, 'utf8')).toBe('abcdefghij');

    // Chunk 0 always starts fresh (a retry after a failed upload).
    await appendRecallChunk({
      partialPath: partial,
      chunkIndex: 0,
      expectedOffset: 0,
      chunkPath: chunks[0]!,
      expectedChunkBytes: 4,
    });
    expect(await fs.readFile(partial, 'utf8')).toBe('abcd');
  });

  test('rejects an out-of-order chunk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-chunk-'));
    cleanup.push(dir);
    const partial = path.join(dir, 'upload.part');
    const chunk = path.join(dir, 'c1');
    await fs.writeFile(chunk, Buffer.from('efgh'));
    await expect(
      appendRecallChunk({
        partialPath: partial,
        chunkIndex: 1,
        expectedOffset: 4,
        chunkPath: chunk,
        expectedChunkBytes: 4,
      })
    ).rejects.toThrow(/out of order/i);
  });
});
