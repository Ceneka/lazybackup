import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  allowArbitraryLocalPaths,
  assertLocalDestinationPath,
  assertRestorableLocalTarget,
  assertSafePathString,
  confineRelativePath,
  expandLocalPath,
  getAllowedLocalStorageRoots,
  isPathInside,
} from './local-paths';

describe('assertSafePathString', () => {
  test('rejects newlines and NUL', () => {
    expect(() => assertSafePathString('a\nb', 'Path')).toThrow(/invalid characters/);
    expect(() => assertSafePathString('a\0b', 'Path')).toThrow(/invalid characters/);
  });
});

describe('confineRelativePath', () => {
  const root = '/backups/job';

  test('joins nested relative segments', () => {
    expect(confineRelativePath(root, 'a/b.txt')).toBe(path.resolve(root, 'a/b.txt'));
  });

  test('rejects .. traversal', () => {
    expect(() => confineRelativePath(root, '../etc/passwd')).toThrow(/traversal/i);
    expect(() => confineRelativePath(root, 'ok/../../etc')).toThrow(/traversal/i);
  });

  test('strips a leading slash so the path stays under root', () => {
    expect(confineRelativePath(root, '/etc/passwd')).toBe(path.resolve(root, 'etc/passwd'));
  });
});

describe('assertLocalDestinationPath', () => {
  const prevStorage = process.env.BACKUP_STORAGE_PATH;
  const prevAllow = process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
  let tmp: string;

  afterEach(async () => {
    if (prevStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prevStorage;
    if (prevAllow === undefined) delete process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
    else process.env.ALLOW_ARBITRARY_LOCAL_PATHS = prevAllow;
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  test('allows destinations under BACKUP_STORAGE_PATH', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-storage-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    delete process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
    const dest = path.join(tmp, 'job');
    expect(assertLocalDestinationPath(dest)).toBe(path.resolve(dest));
  });

  test('rejects /etc/cron.d by default', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-storage-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    delete process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
    expect(() => assertLocalDestinationPath('/etc/cron.d')).toThrow(/BACKUP_STORAGE_PATH/);
  });

  test('ALLOW_ARBITRARY_LOCAL_PATHS permits outside dest', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-storage-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    process.env.ALLOW_ARBITRARY_LOCAL_PATHS = 'true';
    expect(allowArbitraryLocalPaths()).toBe(true);
    expect(assertLocalDestinationPath('/tmp/outside-lb')).toBe(path.resolve('/tmp/outside-lb'));
  });

  test('isPathInside does not treat sibling prefixes as nested', () => {
    expect(isPathInside('/backups/a', '/backups/ab')).toBe(false);
    expect(isPathInside('/backups/a', '/backups/a/b')).toBe(true);
  });

  test('docker aliases include /backups', () => {
    const roots = getAllowedLocalStorageRoots('./backups');
    expect(roots).toContain('/backups');
    expect(roots).toContain('/app/backups');
    expect(isPathInside('/backups', '/backups/foo')).toBe(true);
  });
});

describe('expandLocalPath', () => {
  test('resolves relative paths', () => {
    expect(path.isAbsolute(expandLocalPath('./backups/x'))).toBe(true);
  });
});

describe('assertRestorableLocalTarget', () => {
  const prevStorage = process.env.BACKUP_STORAGE_PATH;
  const prevDb = process.env.DATABASE_URL;
  const prevHome = process.env.HOME;
  let tmp: string | null = null;

  afterEach(async () => {
    if (prevStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prevStorage;
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  test('allows ordinary application paths (restores target the original source)', () => {
    process.env.BACKUP_STORAGE_PATH = '/backups';
    expect(assertRestorableLocalTarget('/srv/app/data')).toBe(
      path.resolve('/srv/app/data')
    );
  });

  test('refuses the filesystem root and system directories', () => {
    process.env.BACKUP_STORAGE_PATH = '/backups';
    expect(() => assertRestorableLocalTarget('/')).toThrow(/Refusing to restore/);
    expect(() => assertRestorableLocalTarget('/boot/efi')).toThrow(
      /Refusing to restore/
    );
    expect(() => assertRestorableLocalTarget('/proc/self')).toThrow(
      /Refusing to restore/
    );
  });

  test('still allows /etc and application trees (config / app recovery)', () => {
    process.env.BACKUP_STORAGE_PATH = '/backups';
    expect(assertRestorableLocalTarget('/etc/nginx')).toBe(
      path.resolve('/etc/nginx')
    );
    expect(assertRestorableLocalTarget('/usr/local/share/app')).toBe(
      path.resolve('/usr/local/share/app')
    );
  });

  test('refuses the storage root and the backup\'s own destination, not other subfolders', () => {
    tmp = path.join(os.tmpdir(), `lbtest-storage-${Date.now()}`);
    process.env.BACKUP_STORAGE_PATH = tmp;
    const ownDest = path.join(tmp, 'server', 'job');
    expect(() => assertRestorableLocalTarget(tmp)).toThrow(/storage root/);
    // Docker: /backups is often the only host mount, so a restore subfolder is fine.
    expect(assertRestorableLocalTarget(path.join(tmp, 'restores', 'app'))).toBe(
      path.join(tmp, 'restores', 'app')
    );
    expect(() =>
      assertRestorableLocalTarget(ownDest, { protectedPaths: [ownDest] })
    ).toThrow(/Refusing to restore/);
    expect(() =>
      assertRestorableLocalTarget(path.join(ownDest, '2026-01-01_00-00-00'), {
        protectedPaths: [ownDest],
      })
    ).toThrow(/Refusing to restore/);
  });

  test('refuses the instance database and its directory', () => {
    tmp = path.join(os.tmpdir(), `lbtest-instance-${Date.now()}`);
    process.env.BACKUP_STORAGE_PATH = '/backups';
    process.env.DATABASE_URL = `file:${path.join(tmp, 'data.db')}`;
    expect(() => assertRestorableLocalTarget(path.join(tmp, 'data.db'))).toThrow(
      /Refusing to restore/
    );
    expect(() => assertRestorableLocalTarget(path.join(tmp, 'other'))).toThrow(
      /Refusing to restore/
    );
  });

  test('refuses the SSH directory', () => {
    tmp = path.join(os.tmpdir(), `lbtest-home-${Date.now()}`);
    process.env.BACKUP_STORAGE_PATH = '/backups';
    process.env.HOME = tmp;
    expect(() => assertRestorableLocalTarget(path.join(tmp, '.ssh'))).toThrow(
      /Refusing to restore/
    );
  });
});
