import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';
import {
  describeFolder,
  folderCandidateSpecs,
  listFolderSuggestions,
  prepareShareDir,
  shareDirChangeError,
} from './folders';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

function testCfg(dir: string): BroConfig {
  return {
    dataDir: dir,
    shareDir: path.join(dir, 'share'),
    port: 3789,
    label: 'Alex',
    pollIntervalMs: 45_000,
    hostBaseUrl: null,
    outboundToken: null,
    localPeerId: null,
    remotePeerId: null,
    remoteLabel: null,
    quotaBytes: 0,
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

describe('shareDirChangeError', () => {
  test('allows the same folder', () => {
    expect(shareDirChangeError('/a/share', '/a/share', 3)).toBeNull();
    expect(shareDirChangeError('/a/share', '/a/share/../share', 3)).toBeNull();
  });

  test('locks the folder while objects are stored', () => {
    const error = shareDirChangeError('/a/share', '/a/new', 1);
    expect(error).toContain('/a/share');
    expect(error).toContain('Disconnect first, or move your folder manually.');
  });

  test('allows a change when nothing is stored yet', () => {
    expect(shareDirChangeError('/a/share', '/a/new', 0)).toBeNull();
  });

  test('rejects an empty path', () => {
    expect(shareDirChangeError('/a/share', '   ', 0)).toMatch(/choose a folder/i);
  });
});

describe('prepareShareDir', () => {
  test('creates the folder and its objects dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-prepare-'));
    cleanup.push(dir);
    const target = path.join(dir, 'LazyBro Share');
    const result = await prepareShareDir(target);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(path.resolve(target));
    await fs.access(path.join(target, 'objects'));
  });

  test('expands a leading tilde', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-tilde-'));
    cleanup.push(dir);
    const target = path.join(dir, 'docs');
    const result = await prepareShareDir(target);
    expect(result.ok).toBe(true);
  });

  test('rejects relative paths, roots, and files', async () => {
    expect(await prepareShareDir('relative/folder')).toEqual({
      ok: false,
      error: 'Use the full path to a folder, for example /home/you/LazyBro Share.',
    });
    expect((await prepareShareDir('/')).ok).toBe(false);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-file-'));
    cleanup.push(dir);
    const file = path.join(dir, 'note.txt');
    await fs.writeFile(file, 'x');
    const result = await prepareShareDir(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/file, not a folder/i);
  });
});

describe('folder suggestions', () => {
  test('lists current, suggested, Documents, Desktop, and mounts without duplicates', () => {
    const specs = folderCandidateSpecs({
      home: '/home/alex',
      current: '/home/alex/LazyBro Share',
      mounts: ['/mnt/disk1', '/Vault'],
    });
    expect(specs[0]).toEqual({
      path: '/home/alex/LazyBro Share',
      label: 'Current folder',
      kind: 'current',
    });
    expect(specs.some((spec) => spec.path === path.join('/home/alex', 'Documents'))).toBe(true);
    expect(specs.some((spec) => spec.path === path.join('/home/alex', 'Desktop'))).toBe(true);
    expect(specs.filter((spec) => spec.path === '/home/alex/LazyBro Share')).toHaveLength(1);
    expect(specs.some((spec) => spec.path === '/mnt/disk1')).toBe(true);
  });

  test('reports free space and flags the current folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-folders-'));
    cleanup.push(dir);
    const home = path.join(dir, 'home');
    const current = path.join(dir, 'current');
    await fs.mkdir(path.join(home, 'Documents'), { recursive: true });
    await fs.mkdir(current, { recursive: true });
    const cfg = testCfg(dir);
    cfg.shareDir = current;
    const folders = await listFolderSuggestions(cfg, {
      home,
      mounts: [path.join(dir, 'mnt-disk')],
      platform: 'linux',
    });
    const currentRow = folders.find((row) => row.path === current);
    expect(currentRow?.current).toBe(true);
    expect(currentRow?.exists).toBe(true);
    expect(currentRow?.freeBytes).toBeGreaterThan(0);
    const suggested = folders.find((row) => row.path === path.join(home, 'LazyBro Share'));
    expect(suggested?.exists).toBe(false);
    expect(suggested?.freeBytes).toBeGreaterThan(0);
    const docs = folders.find((row) => row.path === path.join(home, 'Documents'));
    expect(docs?.exists).toBe(true);
  });

  test('describeFolder marks unwritable folders', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-writable-'));
    cleanup.push(dir);
    const locked = path.join(dir, 'locked');
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o500);
    const row = await describeFolder(locked, 'Locked', false);
    if (process.getuid?.() !== 0) expect(row.writable).toBe(false);
    await fs.chmod(locked, 0o700);
  });
});
