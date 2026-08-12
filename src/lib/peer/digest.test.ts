import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { assertFileSha256, sha256Buffer, sha256File } from './digest';
import { writeCappedBufferToTempFile } from './capped-body';
import { PeerUploadLimitError } from './upload-limit';

describe('artifact digest', () => {
  test('sha256File matches buffer hash', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-digest-'));
    const file = path.join(dir, 'blob.age');
    const data = Buffer.from('ciphertext-bytes');
    await fs.writeFile(file, data);
    try {
      expect(await sha256File(file)).toBe(sha256Buffer(data));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('assertFileSha256 rejects a mismatch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-digest-'));
    const file = path.join(dir, 'blob.age');
    await fs.writeFile(file, 'real');
    try {
      await expect(
        assertFileSha256(file, sha256Buffer(Buffer.from('forged')), 'restore artifact')
      ).rejects.toThrow(/SHA-256 mismatch/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('assertFileSha256 skips when no expected digest (legacy rows)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-digest-'));
    const file = path.join(dir, 'blob.age');
    await fs.writeFile(file, 'real');
    try {
      await assertFileSha256(file, null);
      await assertFileSha256(file, undefined);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('capped body', () => {
  test('rejects a body larger than the ceiling', async () => {
    const data = Buffer.alloc(64, 7);
    await expect(writeCappedBufferToTempFile(data, 16)).rejects.toThrow(PeerUploadLimitError);
  });

  test('writes a body within the ceiling and returns sha256', async () => {
    const data = Buffer.from('hello-quota');
    const result = await writeCappedBufferToTempFile(data, 64);
    try {
      expect(result.size).toBe(data.byteLength);
      expect(result.sha256).toBe(sha256Buffer(data));
      const onDisk = await fs.readFile(result.tempPath);
      expect(onDisk.equals(data)).toBe(true);
    } finally {
      await result.cleanup();
    }
  });
});
