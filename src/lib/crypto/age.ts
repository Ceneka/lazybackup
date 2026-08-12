import * as age from 'age-encryption';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

export type AgeKeyPair = {
  identity: string;
  recipient: string;
};

export async function generateAgeKeyPair(): Promise<AgeKeyPair> {
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  return { identity, recipient };
}

export function ageEncryptedFileName(plainName: string): string {
  return plainName.endsWith('.age') ? plainName : `${plainName}.age`;
}

export function isAgeEncryptedPath(filePath: string): boolean {
  return filePath.endsWith('.age');
}

/** Strip a trailing `.age` for restore naming. */
export function stripAgeExtension(filePath: string): string {
  return filePath.endsWith('.age') ? filePath.slice(0, -4) : filePath;
}

/**
 * Encrypt a local file to `outPath` (binary age format) using the given recipient.
 */
export async function encryptFileToPath(
  inputPath: string,
  outPath: string,
  recipient: string
): Promise<{ bytesIn: number; bytesOut: number }> {
  const input = await fs.readFile(inputPath);
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(input);
  await fs.writeFile(outPath, ciphertext);
  return { bytesIn: input.byteLength, bytesOut: ciphertext.byteLength };
}

/**
 * Stream-encrypt a potentially large file without loading the whole payload when possible.
 * Falls back to buffer encrypt (age-encryption stream API still materializes size metadata).
 */
export async function encryptFileStreaming(
  inputPath: string,
  outPath: string,
  recipient: string
): Promise<{ bytesIn: number; bytesOut: number }> {
  const stat = await fs.stat(inputPath);
  // For very large files use stream API; otherwise buffer is simpler and well-tested.
  if (stat.size > 32 * 1024 * 1024) {
    const encrypter = new age.Encrypter();
    encrypter.addRecipient(recipient);
    const nodeIn = createReadStream(inputPath);
    const webIn = Readable.toWeb(nodeIn) as ReadableStream<Uint8Array>;
    const encryptedStream = await encrypter.encrypt(webIn);
    const nodeOut = createWriteStream(outPath);
    await pipeline(Readable.fromWeb(encryptedStream as never), nodeOut);
    const outStat = await fs.stat(outPath);
    return { bytesIn: stat.size, bytesOut: outStat.size };
  }
  return encryptFileToPath(inputPath, outPath, recipient);
}

/**
 * Decrypt a local `.age` file to `outPath` using the instance identity.
 */
export async function decryptFileToPath(
  inputPath: string,
  outPath: string,
  identity: string
): Promise<{ bytesOut: number }> {
  const ciphertext = await fs.readFile(inputPath);
  const decrypter = new age.Decrypter();
  decrypter.addIdentity(identity);
  const plain = await decrypter.decrypt(ciphertext);
  const bytes =
    typeof plain === 'string' ? Buffer.from(plain, 'utf8') : Buffer.from(plain as Uint8Array);
  await fs.writeFile(outPath, bytes);
  return { bytesOut: bytes.byteLength };
}

export async function encryptBytes(
  data: Uint8Array | string,
  recipient: string
): Promise<Uint8Array> {
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(data);
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  identity: string
): Promise<Uint8Array> {
  const decrypter = new age.Decrypter();
  decrypter.addIdentity(identity);
  const plain = await decrypter.decrypt(ciphertext);
  if (typeof plain === 'string') {
    return new TextEncoder().encode(plain);
  }
  return plain as Uint8Array;
}

/** Ensure Writable is not tree-shaken unused in some bundlers. */
void Writable;
