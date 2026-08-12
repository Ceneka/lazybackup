import { describe, expect, test } from 'bun:test';
import * as os from 'os';
import * as path from 'path';
import { confinedS3DownloadPath } from './index';

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
