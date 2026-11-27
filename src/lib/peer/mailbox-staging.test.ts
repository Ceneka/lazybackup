import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  assertStagingQuota,
  deleteStagedObject,
  listStagedObjects,
  stagedObjectExists,
  writeStagedObject,
} from './staging';

describe('peer staging', () => {
  test('write list delete staged object', async () => {
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    try {
      const src = path.join(tmp, 'src.bin');
      await fs.writeFile(src, Buffer.from('hello-bro'));
      const peerId = 'peer_test';
      const key = 'backups/a/file.age';
      const { size, sha256 } = await writeStagedObject(peerId, key, src);
      expect(size).toBe(9);
      expect(sha256).toHaveLength(64);
      expect(await stagedObjectExists(peerId, key)).toBe(true);
      const listed = await listStagedObjects(peerId);
      expect(listed.some((o) => o.key === key && o.size === 9)).toBe(true);
      await deleteStagedObject(peerId, key);
      expect(await stagedObjectExists(peerId, key)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
      else process.env.BACKUP_STORAGE_PATH = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('a permission error is not mistaken for an already-delivered object', async () => {
    if (process.platform === 'win32') return;
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-perm-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    const peerId = 'peer_perm';
    const key = 'backups/a/file.age';
    const peerDir = path.join(tmp, 'peers-staging', peerId);
    try {
      const src = path.join(tmp, 'src.bin');
      await fs.writeFile(src, Buffer.from('hello-bro'));
      await writeStagedObject(peerId, key, src);
      await fs.chmod(peerDir, 0o000);

      // The ACK reconciliation treats a thrown error as "still staged" (safe);
      // swallowing it as false would mark an undelivered run as stored.
      await expect(stagedObjectExists(peerId, key)).rejects.toThrow();
    } finally {
      await fs.chmod(peerDir, 0o700).catch(() => undefined);
      if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
      else process.env.BACKUP_STORAGE_PATH = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('refuses staging when pending bytes exceed the peer quota', async () => {
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-quota-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    try {
      const src = path.join(tmp, 'src.bin');
      await fs.writeFile(src, Buffer.alloc(6, 1));
      const peerId = 'peer_quota';
      await writeStagedObject(peerId, 'old.age', src);

      await expect(
        assertStagingQuota({
          peerId,
          quotaBytes: 10,
          additionalBytes: 5,
          replacingObjectKey: 'new.age',
        })
      ).rejects.toThrow(/quota exceeded/i);

      // Replacing the same key only counts the net growth.
      await expect(
        assertStagingQuota({
          peerId,
          quotaBytes: 10,
          additionalBytes: 5,
          replacingObjectKey: 'old.age',
        })
      ).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
      else process.env.BACKUP_STORAGE_PATH = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
