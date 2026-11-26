import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';
import { closeDb, deleteAllObjects, listObjects, objectFilePath, upsertObject, usedBytes } from './db';
import { clearPairing, pairingName } from './pair';

function pairedCfg(dir: string): BroConfig {
  return {
    dataDir: dir,
    shareDir: path.join(dir, 'share'),
    port: 3789,
    label: 'Alex',
    pollIntervalMs: 45_000,
    hostBaseUrl: 'http://192.168.0.10:3000',
    outboundToken: 'lbpeer_secret',
    localPeerId: 'local-1',
    remotePeerId: 'remote-1',
    remoteLabel: 'Juan',
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

describe('clearPairing', () => {
  test('drops host, token, peer ids, and quota but keeps the person and folder', () => {
    const cfg = pairedCfg('/tmp/unused');
    clearPairing(cfg);
    expect(cfg.hostBaseUrl).toBeNull();
    expect(cfg.outboundToken).toBeNull();
    expect(cfg.localPeerId).toBeNull();
    expect(cfg.remotePeerId).toBeNull();
    expect(cfg.remoteLabel).toBeNull();
    expect(cfg.quotaBytes).toBe(0);
    expect(cfg.label).toBe('Alex');
    expect(cfg.shareDir).toBe('/tmp/unused/share');
  });
});

describe('pairingName', () => {
  test('never sends the product name as a person', () => {
    expect(pairingName(undefined, 'LazyBro')).toBe('Friend');
    expect(pairingName('  ', 'LazyBro')).toBe('Friend');
  });

  test('prefers the explicit name and keeps a saved person', () => {
    expect(pairingName(' Alex ', 'Old')).toBe('Alex');
    expect(pairingName(undefined, 'Sam')).toBe('Sam');
  });
});

describe('deleteAllObjects (unpair)', () => {
  let tmp: string;
  let cfg: BroConfig;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-unpair-'));
    cfg = pairedCfg(tmp);
    await fs.mkdir(path.join(cfg.shareDir, 'objects'), { recursive: true });
  });

  afterEach(async () => {
    closeDb();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('removes stored files and rows but leaves the share folder', async () => {
    const keys = ['docs/one.tar.gz.age', 'docs/two.tar.gz.age'];
    for (const key of keys) {
      const dest = objectFilePath(cfg, key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.alloc(10, 1));
      upsertObject(cfg, key, 10, new Date().toISOString());
    }
    await fs.writeFile(path.join(cfg.shareDir, 'notes.txt'), 'mine');
    await fs.writeFile(path.join(cfg.shareDir, 'objects', 'unrelated.txt'), 'keep me');
    expect(usedBytes(cfg)).toBe(20);

    const removed = await deleteAllObjects(cfg);

    expect(removed).toEqual({ count: 2, bytes: 20 });
    expect(listObjects(cfg)).toEqual([]);
    expect(usedBytes(cfg)).toBe(0);
    await expect(fs.access(objectFilePath(cfg, keys[0]!))).rejects.toThrow();
    await fs.access(path.join(cfg.shareDir, 'objects'));
    expect(await fs.readFile(path.join(cfg.shareDir, 'objects', 'unrelated.txt'), 'utf8')).toBe(
      'keep me'
    );
    expect(await fs.readFile(path.join(cfg.shareDir, 'notes.txt'), 'utf8')).toBe('mine');
  });
});
