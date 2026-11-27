import { afterEach, describe, expect, test } from 'bun:test';
import * as age from 'age-encryption';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { encryptFileWithPassphrase } from './age';

const PASSPHRASE = 'correct horse battery staple';
const TWENTY_MB = 20 * 1024 * 1024;

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

/** Write `size` deterministic bytes without holding the whole file in memory. */
async function writePatternFile(filePath: string, size: number): Promise<void> {
  const block = Buffer.alloc(64 * 1024);
  for (let i = 0; i < block.length; i += 1) block[i] = (i * 31 + 7) % 251;
  const handle = await fs.open(filePath, 'w');
  try {
    for (let written = 0; written < size; written += block.length) {
      await handle.write(block);
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** Test-only streaming passphrase decrypt (production restores are manual / `age -d`). */
async function decryptFileWithPassphraseForTest(
  inputPath: string,
  outPath: string
): Promise<void> {
  const decrypter = new age.Decrypter();
  decrypter.addPassphrase(PASSPHRASE);
  const input = Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>;
  const plain = await decrypter.decrypt(input);
  await pipeline(Readable.fromWeb(plain as never), createWriteStream(outPath));
}

describe('encryptFileWithPassphrase', () => {
  test('round-trips a 20 MB file without buffering it via readFile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-stream-'));
    cleanup.push(dir);
    const plainPath = path.join(dir, 'instance.tar.gz');
    const encPath = path.join(dir, 'instance.tar.gz.age');
    const outPath = path.join(dir, 'instance.out');
    await writePatternFile(plainPath, TWENTY_MB);

    const originalReadFile = fs.readFile.bind(fs);
    let readFileCalls = 0;
    const readFileSpy = ((...args: Parameters<typeof fs.readFile>) => {
      readFileCalls += 1;
      return originalReadFile(...args);
    }) as typeof fs.readFile;
    Object.assign(fs, { readFile: readFileSpy });
    let result: { bytesIn: number; bytesOut: number };
    try {
      result = await encryptFileWithPassphrase(plainPath, encPath, PASSPHRASE);
    } finally {
      Object.assign(fs, { readFile: originalReadFile });
    }

    expect(readFileCalls).toBe(0);
    expect(result.bytesIn).toBe(TWENTY_MB);
    expect(result.bytesOut).toBe((await fs.stat(encPath)).size);
    expect(result.bytesOut).toBeGreaterThan(0);
    // Contains the SQLite DB + vault + SSH keys.
    expect((await fs.stat(encPath)).mode & 0o777).toBe(0o600);

    await decryptFileWithPassphraseForTest(encPath, outPath);
    expect((await fs.stat(outPath)).size).toBe(TWENTY_MB);
    expect(await sha256File(outPath)).toBe(await sha256File(plainPath));
  }, 120_000);

  test('rejects the wrong passphrase', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-stream-wrong-'));
    cleanup.push(dir);
    const plainPath = path.join(dir, 'small.bin');
    const encPath = path.join(dir, 'small.bin.age');
    await fs.writeFile(plainPath, 'not a real instance tar');
    await encryptFileWithPassphrase(plainPath, encPath, PASSPHRASE);

    const decrypter = new age.Decrypter();
    decrypter.addPassphrase('wrong passphrase');
    const input = Readable.toWeb(createReadStream(encPath)) as ReadableStream<Uint8Array>;
    await expect(decrypter.decrypt(input)).rejects.toThrow();
  });

  test('removes the partial output when the input disappears mid-flight', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-stream-missing-'));
    cleanup.push(dir);
    const encPath = path.join(dir, 'missing.age');
    await expect(
      encryptFileWithPassphrase(path.join(dir, 'does-not-exist.tar.gz'), encPath, PASSPHRASE)
    ).rejects.toThrow();
    expect(await fs.stat(encPath).catch(() => null)).toBeNull();
  });
});
