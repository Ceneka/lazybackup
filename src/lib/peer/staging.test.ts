import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
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
});
