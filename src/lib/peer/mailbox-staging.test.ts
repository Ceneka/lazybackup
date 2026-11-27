import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
// Bypass process-wide mocks of ./staging installed by other test files.
const {
  assertStagingQuota,
  deleteStagedObject,
  listStagedObjects,
  peerStagingTempDir,
  peerStagingTempPath,
  stagedObjectDigest,
  stagedObjectExists,
  stagingUsedBytes,
  writeStagedObject,
} = await import(`./staging.ts?real=${Date.now()}`);

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

  test('in-progress staging copies are invisible to the mailbox', async () => {
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-partial-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    try {
      const peerId = 'peer_partial';
      const key = 'backups/config/big.tar.gz.age';
      // A copy that is still being written (or was left by a crash).
      const partial = peerStagingTempPath(peerId, key);
      await fs.mkdir(path.dirname(partial), { recursive: true });
      await fs.writeFile(partial, Buffer.alloc(1024, 7));

      expect(await listStagedObjects(peerId)).toEqual([]);
      expect(await stagingUsedBytes(peerId)).toBe(0);
      expect(await stagedObjectExists(peerId, key)).toBe(false);
      await fs.unlink(partial);

      // Completed writes publish exactly one object and leave no temp behind.
      const src = path.join(tmp, 'src.bin');
      await fs.writeFile(src, Buffer.from('complete-artifact'));
      const staged = await writeStagedObject(peerId, key, src);
      expect(staged.size).toBe(17);
      const listed = await listStagedObjects(peerId);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.key).toBe(key);
      expect(await stagingUsedBytes(peerId)).toBe(17);
      const leftovers = await fs.readdir(peerStagingTempDir(peerId)).catch(() => []);
      expect(leftovers).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
      else process.env.BACKUP_STORAGE_PATH = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('a legitimate object key containing ".part-" is still advertised', async () => {
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-partname-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    try {
      const peerId = 'peer_partname';
      // Volume names and source paths may contain ".part-": the temp marker
      // must not hide a real staged object from the friend.
      const key = 'backups/vol/app.part-2024.tar.gz.age';
      const src = path.join(tmp, 'src.bin');
      await fs.writeFile(src, Buffer.from('hello'));
      await writeStagedObject(peerId, key, src);

      const listed = await listStagedObjects(peerId);
      expect(listed.map((object) => object.key)).toContain(key);
      expect(await stagingUsedBytes(peerId)).toBe(5);
      expect(
        await stagedObjectExists(peerId, key)
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
      else process.env.BACKUP_STORAGE_PATH = prev;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('a failed staging copy publishes nothing', async () => {
    const prev = process.env.BACKUP_STORAGE_PATH;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-stage-fail-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    try {
      const peerId = 'peer_fail';
      const key = 'backups/config/broken.tar.gz.age';
      await expect(
        writeStagedObject(peerId, key, path.join(tmp, 'missing.bin'))
      ).rejects.toThrow();
      expect(await stagedObjectExists(peerId, key)).toBe(false);
      expect(await listStagedObjects(peerId)).toEqual([]);
      const leftovers = await fs.readdir(peerStagingTempDir(peerId)).catch(() => []);
      expect(leftovers).toEqual([]);
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
      // swallowing it as false would mark an undelivered run as stored. The
      // ACK digest path must likewise not report a 404 that ends ACK retries.
      await expect(stagedObjectExists(peerId, key)).rejects.toThrow();
      await expect(stagedObjectDigest(peerId, key)).rejects.toThrow();
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
