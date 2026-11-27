import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

export const BRO_OBJECT_HARD_CAP_BYTES = 32 * 1024 * 1024 * 1024;

/**
 * Remove `*.partial-*` temp files left by a crash mid-download. Walks the
 * objects dir without following symlinks so a stray link can never delete
 * files outside the share folder.
 */
export async function sweepPartialFiles(objectsDir: string): Promise<number> {
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.includes('.partial-')) continue;
      try {
        await fs.unlink(full);
        removed += 1;
      } catch {
        /* already gone */
      }
    }
  };
  await walk(objectsDir);
  return removed;
}

export async function streamResponseToFile(options: {
  response: Response;
  destPath: string;
  maxBytes: number;
  expectedBytes?: number;
}): Promise<{ size: number; sha256: string }> {
  const rawLength = options.response.headers.get('content-length')?.trim();
  if (!rawLength || !/^\d+$/.test(rawLength)) {
    throw new Error('Peer response requires Content-Length');
  }
  const declared = Number(rawLength);
  if (!Number.isSafeInteger(declared) || declared > options.maxBytes) {
    throw new Error(`Peer response exceeds maximum of ${options.maxBytes} bytes`);
  }
  if (options.expectedBytes != null && declared !== options.expectedBytes) {
    throw new Error(
      `Peer response size mismatch: expected ${options.expectedBytes}, declared ${declared}`
    );
  }
  if (!options.response.body) throw new Error('Peer response body is missing');

  await fs.mkdir(path.dirname(options.destPath), { recursive: true });
  const tempPath = `${options.destPath}.partial-${randomUUID()}`;
  const hash = createHash('sha256');
  let size = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > declared || size > options.maxBytes) {
        callback(new Error(`Peer response exceeds maximum of ${options.maxBytes} bytes`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(options.response.body as never),
      limiter,
      createWriteStream(tempPath, { flags: 'wx' })
    );
    if (size !== declared) {
      throw new Error(`Content-Length mismatch: declared ${declared}, received ${size}`);
    }
    await fs.rename(tempPath, options.destPath);
    return { size, sha256: hash.digest('hex') };
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
