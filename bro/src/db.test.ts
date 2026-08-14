import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';
import {
  closeDb,
  getObject,
  objectFilePath,
  unlinkObject,
  upsertObject,
  usedBytes,
} from './db';

function testCfg(dir: string): BroConfig {
  return {
    dataDir: dir,
    shareDir: path.join(dir, 'share'),
    port: 3789,
    label: 'test',
    pollIntervalMs: 45_000,
    hostBaseUrl: null,
    outboundToken: null,
    localPeerId: null,
    remotePeerId: null,
    remoteLabel: null,
    quotaBytes: 1024,
    folderBackupPath: null,
    folderBackupIntervalMs: 0,
    lastFolderBackupAt: null,
    ageIdentity: null,
    ageRecipient: null,
    autostartPrompted: false,
    openUiOnStart: false,
    localApiToken: 'test-local-api-token',
  };
}

describe('objectFilePath', () => {
  let tmp: string;
  let cfg: BroConfig;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-db-'));
    cfg = testCfg(tmp);
    await fs.mkdir(path.join(cfg.shareDir, 'objects'), { recursive: true });
  });

  afterEach(async () => {
    closeDb();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('rejects path traversal keys', () => {
    expect(() => objectFilePath(cfg, '../secret')).toThrow(/Invalid object key/);
    expect(() => objectFilePath(cfg, 'foo/../../etc/passwd')).toThrow(/Invalid object key/);
    expect(() => objectFilePath(cfg, '')).toThrow(/Invalid object key/);
  });

  test('keeps resolved paths under shareDir/objects', () => {
    const dest = objectFilePath(cfg, 'db/app.sql.gz.age');
    expect(dest.startsWith(path.resolve(cfg.shareDir, 'objects') + path.sep)).toBe(true);
    expect(dest.endsWith(`${path.sep}db${path.sep}app.sql.gz.age`)).toBe(true);
  });
});

describe('unlinkObject', () => {
  let tmp: string;
  let cfg: BroConfig;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-unlink-'));
    cfg = testCfg(tmp);
    await fs.mkdir(path.join(cfg.shareDir, 'objects'), { recursive: true });
  });

  afterEach(async () => {
    closeDb();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('unlinks the file, drops the sqlite row, and frees usedBytes', async () => {
    const key = 'app/obj.age';
    const dest = objectFilePath(cfg, key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.alloc(32, 7));
    upsertObject(cfg, key, 32, new Date().toISOString());
    expect(usedBytes(cfg)).toBe(32);

    await unlinkObject(cfg, key);

    expect(getObject(cfg, key)).toBeNull();
    expect(usedBytes(cfg)).toBe(0);
    await expect(fs.access(dest)).rejects.toThrow();
  });

  test('refuses to unlink a traversal key', async () => {
    await expect(unlinkObject(cfg, '../outside.bin')).rejects.toThrow(/Invalid object key/);
  });
});
