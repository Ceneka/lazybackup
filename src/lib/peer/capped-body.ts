import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { PeerUploadLimitError } from './upload-limit';

export type CappedBodyResult = {
  tempPath: string;
  size: number;
  sha256: string;
  cleanup: () => Promise<void>;
};

/**
 * Stream a request body to a temp file, aborting if it exceeds `maxBytes`.
 * Caller must `cleanup()` (unlinks the temp dir).
 */
export async function writeCappedBodyToTempFile(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<CappedBodyResult> {
  if (!body) {
    throw new PeerUploadLimitError('Missing request body', 400);
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new PeerUploadLimitError('Invalid upload size limit', 400);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-upload-'));
  const tempPath = path.join(dir, 'body');
  const hash = createHash('sha256');
  let size = 0;

  const cleanup = async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const nodeReadable = Readable.fromWeb(body as never);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const out = createWriteStream(tempPath);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        nodeReadable.destroy();
        out.destroy();
        reject(err);
      };

      nodeReadable.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (size + chunk.byteLength > maxBytes) {
          fail(
            new PeerUploadLimitError(
              `Upload exceeds maximum of ${maxBytes} bytes`,
              413
            )
          );
          return;
        }
        size += chunk.byteLength;
        hash.update(chunk);
        const ok = out.write(chunk);
        if (!ok) {
          nodeReadable.pause();
          out.once('drain', () => nodeReadable.resume());
        }
      });
      nodeReadable.on('error', fail);
      nodeReadable.on('end', () => {
        if (settled) return;
        out.end();
      });
      out.on('error', fail);
      out.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    tempPath,
    size,
    sha256: hash.digest('hex'),
    cleanup,
  };
}

export async function moveCappedTempToDest(
  tempPath: string,
  destPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(tempPath, destPath);
}

/** Test helper: stream a buffer through the same cap path. */
export async function writeCappedBufferToTempFile(
  data: Buffer,
  maxBytes: number
): Promise<CappedBodyResult> {
  const stream = Readable.toWeb(Readable.from(data)) as ReadableStream<Uint8Array>;
  return writeCappedBodyToTempFile(stream, maxBytes);
}
