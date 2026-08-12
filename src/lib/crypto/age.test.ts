import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { MIN_WRAP_PASSPHRASE_LENGTH } from './constants';
import {
  ageEncryptedFileName,
  assertAgeRecipient,
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

  test('multi-recipient encrypt + multi-identity decrypt', async () => {
    const a = await generateAgeKeyPair();
    const b = await generateAgeKeyPair();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-age-multi-'));
    try {
      const plain = path.join(dir, 'data.bin');
      const enc = path.join(dir, 'data.bin.age');
      const out = path.join(dir, 'data.out');
      await fs.writeFile(plain, 'vault-data');
      await encryptFileToPath(plain, enc, [a.recipient, b.recipient]);
      // Decrypt with only the second identity
      await decryptFileToPath(enc, out, [b.identity]);
      expect(await fs.readFile(out, 'utf8')).toBe('vault-data');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('passphrase wrap round-trip', async () => {
    const { encryptWithPassphrase, decryptWithPassphrase } = await import('./age');
    const armored = await encryptWithPassphrase('AGE-SECRET-KEY-1TEST', 'correct horse battery');
    expect(armored).toContain('BEGIN AGE ENCRYPTED FILE');
    const plain = await decryptWithPassphrase(armored, 'correct horse battery');
    expect(plain).toBe('AGE-SECRET-KEY-1TEST');
  });

  test('filename helpers', () => {
    expect(ageEncryptedFileName('a.sql.gz')).toBe('a.sql.gz.age');
    expect(ageEncryptedFileName('a.sql.gz.age')).toBe('a.sql.gz.age');
    expect(stripAgeExtension('a.sql.gz.age')).toBe('a.sql.gz');
    expect(isAgeEncryptedPath('/x/y.age')).toBe(true);
  });

  test('passphrase wrap minimum is 12', () => {
    expect(MIN_WRAP_PASSPHRASE_LENGTH).toBe(12);
  });

  test('assertAgeRecipient accepts a real age1 recipient', async () => {
    const { recipient } = await generateAgeKeyPair();
    expect(assertAgeRecipient(recipient)).toBe(recipient);
    expect(assertAgeRecipient(`  ${recipient}  `)).toBe(recipient);
  });

  test('assertAgeRecipient rejects non-age and invalid Bech32', async () => {
    const { identity } = await generateAgeKeyPair();
    expect(() => assertAgeRecipient('age1not-a-valid-key')).toThrow(/Invalid age recipient/);
    expect(() => assertAgeRecipient('age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toThrow(
      /Invalid age recipient/
    );
    expect(() => assertAgeRecipient('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI')).toThrow(
      /Invalid age recipient/
    );
    expect(() => assertAgeRecipient('not-age')).toThrow(/Invalid age recipient/);
    expect(() => assertAgeRecipient('age1')).toThrow(/Invalid age recipient/);
    expect(() => assertAgeRecipient(identity)).toThrow(/Invalid age recipient/);
    expect(() => assertAgeRecipient('')).toThrow(/required/);
    expect(() => assertAgeRecipient('   ')).toThrow(/required/);
  });
});
