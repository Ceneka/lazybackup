import fs from 'fs/promises';
import path from 'path';

/**
 * Recall uploads are split into chunks so each HTTP request body stays small.
 * The Next middleware already skips `/api/peers/agent/*` bodies, but reverse
 * proxies in front of LazyBackup (Cloudflare Tunnel caps request bodies at
 * 100 MB) still see a single PUT; chunking keeps every request proxy-safe and
 * lets a failed upload resume from chunk 0 without re-sending a huge body.
 */
export const PEER_RECALL_CHUNK_MAX_BYTES = 4 * 1024 * 1024;

export type RecallChunkPlan = {
  index: number;
  /** Byte offset of the first byte in the artifact */
  start: number;
  /** Byte offset just past the last byte */
  end: number;
  length: number;
};

export function planRecallChunks(
  totalBytes: number,
  chunkMax: number = PEER_RECALL_CHUNK_MAX_BYTES
): RecallChunkPlan[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid recall size');
  }
  if (!Number.isSafeInteger(chunkMax) || chunkMax <= 0) {
    throw new Error('Invalid recall chunk size');
  }
  if (totalBytes === 0) return [];

  const chunks: RecallChunkPlan[] = [];
  let index = 0;
  for (let start = 0; start < totalBytes; start += chunkMax) {
    const end = Math.min(totalBytes, start + chunkMax);
    chunks.push({ index, start, end, length: end - start });
    index += 1;
  }
  return chunks;
}

/**
 * Append one chunk to the in-progress partial artifact.
 * Chunk 0 always starts a fresh file (so a failed upload can restart cleanly);
 * later chunks must arrive in order at the exact expected offset.
 */
export async function appendRecallChunk(options: {
  partialPath: string;
  chunkIndex: number;
  expectedOffset: number;
  chunkPath: string;
  expectedChunkBytes: number;
}): Promise<number> {
  const { partialPath, chunkIndex, expectedOffset, chunkPath, expectedChunkBytes } = options;

  const chunkStat = await fs.stat(chunkPath);
  if (chunkStat.size !== expectedChunkBytes) {
    throw new Error(
      `Recall chunk size mismatch: expected ${expectedChunkBytes} bytes, got ${chunkStat.size}`
    );
  }

  if (chunkIndex === 0) {
    await fs.mkdir(path.dirname(partialPath), { recursive: true });
    await fs.copyFile(chunkPath, partialPath);
  } else {
    const partial = await fs.stat(partialPath).catch(() => null);
    if (!partial || partial.size !== expectedOffset) {
      throw new Error('Recall chunk out of order; restart the upload from chunk 0');
    }
    await fs.appendFile(partialPath, await fs.readFile(chunkPath));
  }

  return (await fs.stat(partialPath)).size;
}
