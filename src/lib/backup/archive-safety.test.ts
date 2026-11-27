import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { pack, type Headers } from 'tar-stream';
import { assertSafeTarGzArchive, validateTarMembers } from './archive-safety';

async function writeTarGz(
  archivePath: string,
  entries: Array<{ header: Headers; body?: string }>
): Promise<void> {
  const archive = pack();
  const writing = pipeline(archive, createGzip(), createWriteStream(archivePath));
  for (const entry of entries) {
    archive.entry(entry.header, entry.body ?? '');
  }
  archive.finalize();
  await writing;
}

describe('validateTarMembers', () => {
  test('accepts ordinary members and internal symlinks/hardlinks', () => {
    expect(() =>
      validateTarMembers([
        { type: 'd', name: 'app/' },
        { type: '-', name: 'app/data.txt' },
        { type: 'l', name: 'app/current', linkTarget: 'data.txt' },
        { type: 'h', name: 'app/copy.txt', linkTarget: 'app/data.txt' },
      ])
    ).not.toThrow();
  });

  test('rejects absolute and traversal member names', () => {
    expect(() => validateTarMembers([{ type: '-', name: '/etc/passwd' }])).toThrow(/absolute/i);
    expect(() => validateTarMembers([{ type: '-', name: '../outside' }])).toThrow(/traversal/i);
  });

  test('rejects escaping symlink targets', () => {
    expect(() =>
      validateTarMembers([
        { type: 'd', name: 'app/' },
        { type: 'l', name: 'app/link', linkTarget: '../../outside' },
      ])
    ).toThrow(/symlink|traversal/i);
    expect(() =>
      validateTarMembers([{ type: 'l', name: 'link', linkTarget: '/etc/passwd' }])
    ).toThrow(/absolute/i);
  });

  test('rejects escaping or absent hardlink targets', () => {
    expect(() =>
      validateTarMembers([{ type: 'h', name: 'copy', linkTarget: '../outside' }])
    ).toThrow(/hardlink|traversal/i);
    expect(() =>
      validateTarMembers([{ type: 'h', name: 'copy', linkTarget: 'missing' }])
    ).toThrow(/not in archive/i);
  });

  test('reports external symlinks instead of throwing when restoring', () => {
    const members = [
      { type: 'd', name: 'app/' },
      { type: 'l', name: 'app/abs', linkTarget: '/etc/passwd' },
      { type: 'l', name: 'app/up', linkTarget: '../../outside' },
      { type: 'l', name: 'app/ok', linkTarget: 'data.txt' },
    ];
    expect(() => validateTarMembers(members)).toThrow(/symlink/i);
    expect(
      validateTarMembers(members, { allowExternalSymlinks: true }).map((m) => m.name)
    ).toEqual(['app/abs', 'app/up']);
  });

  test('still rejects unsafe member names and hardlinks when tolerating symlinks', () => {
    const options = { allowExternalSymlinks: true };
    expect(() =>
      validateTarMembers([{ type: '-', name: '/etc/passwd' }], options)
    ).toThrow(/absolute/i);
    expect(() =>
      validateTarMembers([{ type: '-', name: '../outside' }], options)
    ).toThrow(/traversal/i);
    expect(() =>
      validateTarMembers(
        [
          { type: '-', name: 'app/data.txt' },
          { type: 'h', name: 'copy', linkTarget: '../outside' },
        ],
        options
      )
    ).toThrow(/hardlink|traversal/i);
    expect(() =>
      validateTarMembers(
        [{ type: 'h', name: 'copy', linkTarget: 'missing' }],
        options
      )
    ).toThrow(/not in archive/i);
  });
});

describe('validateTarMembers symlink parents', () => {
  test('rejects members written through a symlink member', () => {
    expect(() =>
      validateTarMembers(
        [
          { type: 'l', name: 'd', linkTarget: '/etc' },
          { type: '-', name: 'd/passwd' },
        ],
        { allowExternalSymlinks: true }
      )
    ).toThrow('path goes through a symlink');
    expect(() =>
      validateTarMembers([
        { type: 'd', name: 'sub/' },
        { type: 'l', name: 'a', linkTarget: 'sub' },
        { type: '-', name: 'a/x' },
      ])
    ).toThrow('path goes through a symlink');
  });
});

describe('assertSafeTarGzArchive', () => {
  test('inspects archives without relying on GNU tar options', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-tar-inspect-'));
    const archive = path.join(root, 'safe.tar.gz');
    try {
      await writeTarGz(archive, [
        { header: { type: 'directory', name: 'app/' } },
        { header: { type: 'file', name: 'app/data.txt' }, body: 'ok' },
        {
          header: {
            type: 'symlink',
            name: 'app/current',
            linkname: 'data.txt',
          },
        },
      ]);
      await expect(assertSafeTarGzArchive(archive)).resolves.toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('rejects dangerous names directly from archive headers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-tar-inspect-'));
    const archive = path.join(root, 'unsafe.tar.gz');
    try {
      await writeTarGz(archive, [
        { header: { type: 'file', name: '/etc/passwd' }, body: 'bad' },
      ]);
      await expect(assertSafeTarGzArchive(archive)).rejects.toThrow(/absolute/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('returns external symlinks when allowed (absolute and escaping)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-tar-inspect-'));
    const archive = path.join(root, 'symlinks.tar.gz');
    try {
      await writeTarGz(archive, [
        { header: { type: 'directory', name: 'app/' } },
        { header: { type: 'file', name: 'app/data.txt' }, body: 'ok' },
        { header: { type: 'symlink', name: 'app/abs', linkname: '/etc/hostname' } },
        { header: { type: 'symlink', name: 'app/up', linkname: '../../outside' } },
        { header: { type: 'symlink', name: 'app/ok', linkname: 'data.txt' } },
      ]);
      const external = await assertSafeTarGzArchive(archive, {
        allowExternalSymlinks: true,
      });
      expect(external.map((m) => m.name)).toEqual(['app/abs', 'app/up']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
