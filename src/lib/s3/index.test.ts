import { describe, expect, test } from 'bun:test';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { confinedS3DownloadPath, listLocalFilesForS3Upload } from './index';

describe('confinedS3DownloadPath', () => {
  const dir = path.join(os.tmpdir(), 'lb-s3-dest');

  test('joins keys under localDir', () => {
    expect(confinedS3DownloadPath(dir, 'backups/job/a.txt', 'backups/job')).toBe(
      path.resolve(dir, 'a.txt')
    );
  });

  test('rejects .. traversal', () => {
    expect(() => confinedS3DownloadPath(dir, 'backups/job/../../etc/passwd', 'backups/job')).toThrow(
      /traversal/i
    );
  });

  test('strips a leading slash and still stays under localDir', () => {
    expect(confinedS3DownloadPath(dir, '/a.txt', '')).toBe(path.resolve(dir, 'a.txt'));
  });
});

describe('listLocalFilesForS3Upload', () => {
  test('reports symlinks instead of silently skipping them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-s3-symlink-'));
    try {
      await fs.mkdir(path.join(root, 'sub'));
      await fs.writeFile(path.join(root, 'sub', 'real.txt'), 'data');
      await fs.symlink('/etc/passwd', path.join(root, 'leak'));
      await fs.symlink('sub', path.join(root, 'dirlink'));
      await fs.symlink('missing-target', path.join(root, 'broken'));

      const { files, skippedSymlinks } = await listLocalFilesForS3Upload(root);

      expect(files).toHaveLength(1);
      expect(files[0].endsWith(path.join('sub', 'real.txt'))).toBe(true);
      expect(skippedSymlinks.sort()).toEqual(['broken', 'dirlink', 'leak']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
