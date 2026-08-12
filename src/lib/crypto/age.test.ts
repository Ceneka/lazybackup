import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ageEncryptedFileName,
  decryptFileToPath,
  encryptFileToPath,
  generateAgeKeyPair,
  isAgeEncryptedPath,
  stripAgeExtension,
} from './age';
import { decryptLocalFile, encryptLocalFile } from './files';

describe('age crypto', () => {
  test('generate, encrypt, decrypt round-trip', async () => {
    const { identity, recipient } = await generateAgeKeyPair();
    expect(identity.startsWith('AGE-SECRET-KEY-')).toBe(true);
    expect(recipient.startsWith('age1')).toBe(true);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-'));
    try {
      const plain = path.join(dir, 'hello.txt');
      const enc = path.join(dir, 'hello.txt.age');
      const out = path.join(dir, 'hello.out');
      await fs.writeFile(plain, 'secret-bro-data');
      await encryptFileToPath(plain, enc, recipient);
      await decryptFileToPath(enc, out, identity);
      expect(await fs.readFile(out, 'utf8')).toBe('secret-bro-data');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('encryptLocalFile / decryptLocalFile helpers', async () => {
    const { identity, recipient } = await generateAgeKeyPair();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-'));
    try {
      const plain = path.join(dir, 'dump.sql.gz');
      await fs.writeFile(plain, Buffer.from([1, 2, 3, 4, 5]));
      const { outPath } = await encryptLocalFile(plain, recipient);
      expect(isAgeEncryptedPath(outPath)).toBe(true);
      const dec = await decryptLocalFile(outPath, identity);
      expect(await fs.readFile(dec.outPath)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('filename helpers', () => {
    expect(ageEncryptedFileName('a.sql.gz')).toBe('a.sql.gz.age');
    expect(ageEncryptedFileName('a.sql.gz.age')).toBe('a.sql.gz.age');
    expect(stripAgeExtension('a.sql.gz.age')).toBe('a.sql.gz');
    expect(isAgeEncryptedPath('/x/y.age')).toBe(true);
  });
});
