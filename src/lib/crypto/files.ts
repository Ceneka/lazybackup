import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as age from 'age-encryption';
import {
  decryptFileToPath,
  encryptFileToPath,
  stripAgeExtension,
} from './age';

export { ageEncryptedFileName, isAgeEncryptedPath, stripAgeExtension } from './age';

const STREAM_THRESHOLD = 16 * 1024 * 1024; // 16 MiB

/**
 * Encrypt `inputPath` → sibling or explicit out path with `.age` suffix.
 * Accepts one recipient or many (active + recovery).
 */
export async function encryptLocalFile(
  inputPath: string,
  recipients: string | string[],
  outPath?: string
): Promise<{ outPath: string; bytesIn: number; bytesOut: number }> {
  const dest = outPath ?? `${inputPath}.age`;
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const stat = await fs.stat(inputPath);

  if (stat.size <= STREAM_THRESHOLD) {
    const result = await encryptFileToPath(inputPath, dest, list);
    return { outPath: dest, ...result };
  }

  const encrypter = new age.Encrypter();
  for (const recipient of list) {
    encrypter.addRecipient(recipient);
  }
  const webIn = Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>;
  const encryptedStream = await encrypter.encrypt(webIn);
  await pipeline(Readable.fromWeb(encryptedStream as never), createWriteStream(dest));
  const outStat = await fs.stat(dest);
  return { outPath: dest, bytesIn: stat.size, bytesOut: outStat.size };
}

/**
 * Decrypt an `.age` file into `outDir` (or beside the input), returning the plaintext path.
 * Accepts one identity or many (vault keys).
 */
export async function decryptLocalFile(
  inputPath: string,
  identities: string | string[],
  outPath?: string
): Promise<{ outPath: string; bytesOut: number }> {
  const dest =
    outPath ??
    path.join(
      path.dirname(inputPath),
      stripAgeExtension(path.basename(inputPath))
    );
  if (dest === inputPath) {
    throw new Error('Decrypt output path must differ from input');
  }
  const result = await decryptFileToPath(inputPath, dest, identities);
  return { outPath: dest, ...result };
}
