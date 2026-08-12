import * as age from 'age-encryption';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

export type AgeKeyPair = {
  identity: string;
  recipient: string;
};

/**
 * Parse and validate an age recipient via the age-encryption library
 * (Bech32 HRP + checksum, X25519 / hybrid / tag types).
 */
export function assertAgeRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  if (!trimmed) {
    throw new Error('Recipient is required');
  }
  try {
    const encrypter = new age.Encrypter();
    encrypter.addRecipient(trimmed);
  } catch {
    throw new Error('Invalid age recipient (expected a Bech32 age1… public key)');
  }
  return trimmed;
}

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

function normalizeRecipients(recipients: string | string[]): string[] {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const unique = [...new Set(list.map((r) => r.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('At least one age recipient is required');
  }
  return unique;
}

function normalizeIdentities(identities: string | string[]): string[] {
  const list = Array.isArray(identities) ? identities : [identities];
  const unique = [...new Set(list.map((i) => i.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('At least one age identity is required');
  }
  return unique;
}

function makeEncrypter(recipients: string[]): age.Encrypter {
  const encrypter = new age.Encrypter();
  for (const recipient of recipients) {
    encrypter.addRecipient(recipient);
  }
  return encrypter;
}

function makeDecrypter(identities: string[]): age.Decrypter {
  const decrypter = new age.Decrypter();
  for (const identity of identities) {
    decrypter.addIdentity(identity);
  }
  return decrypter;
}

/**
 * Encrypt a local file to `outPath` (binary age format) using one or more recipients.
 */
export async function encryptFileToPath(
  inputPath: string,
  outPath: string,
  recipients: string | string[]
): Promise<{ bytesIn: number; bytesOut: number }> {
  const input = await fs.readFile(inputPath);
  const encrypter = makeEncrypter(normalizeRecipients(recipients));
  const ciphertext = await encrypter.encrypt(input);
  await fs.writeFile(outPath, ciphertext);
  return { bytesIn: input.byteLength, bytesOut: ciphertext.byteLength };
}

/**
 * Stream-encrypt a potentially large file without loading the whole payload when possible.
 */
export async function encryptFileStreaming(
  inputPath: string,
  outPath: string,
  recipients: string | string[]
): Promise<{ bytesIn: number; bytesOut: number }> {
  const stat = await fs.stat(inputPath);
  const recipientList = normalizeRecipients(recipients);
  if (stat.size > 32 * 1024 * 1024) {
    const encrypter = makeEncrypter(recipientList);
    const nodeIn = createReadStream(inputPath);
    const webIn = Readable.toWeb(nodeIn) as ReadableStream<Uint8Array>;
    const encryptedStream = await encrypter.encrypt(webIn);
    const nodeOut = createWriteStream(outPath);
    await pipeline(Readable.fromWeb(encryptedStream as never), nodeOut);
    const outStat = await fs.stat(outPath);
    return { bytesIn: stat.size, bytesOut: outStat.size };
  }
  return encryptFileToPath(inputPath, outPath, recipientList);
}

/**
 * Decrypt a local `.age` file to `outPath` using one or more identities.
 */
export async function decryptFileToPath(
  inputPath: string,
  outPath: string,
  identities: string | string[]
): Promise<{ bytesOut: number }> {
  const ciphertext = await fs.readFile(inputPath);
  const decrypter = makeDecrypter(normalizeIdentities(identities));
  const plain = await decrypter.decrypt(ciphertext);
  const bytes =
    typeof plain === 'string' ? Buffer.from(plain, 'utf8') : Buffer.from(plain as Uint8Array);
  await fs.writeFile(outPath, bytes);
  return { bytesOut: bytes.byteLength };
}

export async function encryptBytes(
  data: Uint8Array | string,
  recipients: string | string[]
): Promise<Uint8Array> {
  const encrypter = makeEncrypter(normalizeRecipients(recipients));
  return encrypter.encrypt(data);
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  identities: string | string[]
): Promise<Uint8Array> {
  const decrypter = makeDecrypter(normalizeIdentities(identities));
  const plain = await decrypter.decrypt(ciphertext);
  if (typeof plain === 'string') {
    return new TextEncoder().encode(plain);
  }
  return plain as Uint8Array;
}

/** Encrypt UTF-8 text with an age passphrase; returns armored ciphertext. */
export async function encryptWithPassphrase(
  plaintext: string,
  passphrase: string
): Promise<string> {
  const encrypter = new age.Encrypter();
  encrypter.setPassphrase(passphrase);
  const ciphertext = await encrypter.encrypt(plaintext);
  return age.armor.encode(ciphertext);
}

/** Decrypt passphrase-wrapped armored age ciphertext to UTF-8 text. */
export async function decryptWithPassphrase(
  armored: string,
  passphrase: string
): Promise<string> {
  const decoded = age.armor.decode(armored);
  const decrypter = new age.Decrypter();
  decrypter.addPassphrase(passphrase);
  const plain = await decrypter.decrypt(decoded, 'text');
  return typeof plain === 'string' ? plain : new TextDecoder().decode(plain as Uint8Array);
}

/** Encrypt a file with an age passphrase (binary `.age` output). */
export async function encryptFileWithPassphrase(
  inputPath: string,
  outPath: string,
  passphrase: string
): Promise<{ bytesIn: number; bytesOut: number }> {
  const input = await fs.readFile(inputPath);
  const encrypter = new age.Encrypter();
  encrypter.setPassphrase(passphrase);
  const ciphertext = await encrypter.encrypt(input);
  await fs.writeFile(outPath, ciphertext);
  return { bytesIn: input.byteLength, bytesOut: ciphertext.byteLength };
}

/** Ensure Writable is not tree-shaken unused in some bundlers. */
void Writable;
