import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as age from 'age-encryption';
import {
  ageEncryptedFileName,
  decryptFileToPath,
  encryptFileToPath,
  generateAgeKeyPair,
  isAgeEncryptedPath,
  stripAgeExtension,
  type AgeKeyPair,
} from './age';

export {
  ageEncryptedFileName,
  decryptFileToPath,
  encryptFileToPath,
  generateAgeKeyPair,
  isAgeEncryptedPath,
  stripAgeExtension,
  type AgeKeyPair,
};

const STREAM_THRESHOLD = 16 * 1024 * 1024; // 16 MiB

/**
 * Encrypt `inputPath` → sibling or explicit out path with `.age` suffix.
 * Uses streaming for larger files.
 */
export async function encryptLocalFile(
  inputPath: string,
  recipient: string,
  outPath?: string
): Promise<{ outPath: string; bytesIn: number; bytesOut: number }> {
  const dest = outPath ?? `${inputPath}.age`;
  const stat = await fs.stat(inputPath);

  if (stat.size <= STREAM_THRESHOLD) {
    const result = await encryptFileToPath(inputPath, dest, recipient);
    return { outPath: dest, ...result };
  }

  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const webIn = Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>;
  const encryptedStream = await encrypter.encrypt(webIn);
  await pipeline(Readable.fromWeb(encryptedStream as never), createWriteStream(dest));
  const outStat = await fs.stat(dest);
  return { outPath: dest, bytesIn: stat.size, bytesOut: outStat.size };
}

/**
 * Decrypt an `.age` file into `outDir` (or beside the input), returning the plaintext path.
 */
export async function decryptLocalFile(
  inputPath: string,
  identity: string,
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
  const result = await decryptFileToPath(inputPath, dest, identity);
  return { outPath: dest, ...result };
}
