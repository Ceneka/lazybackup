import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  compareVersionDirNames,
  createUniqueLocalVersionDir,
  cleanupLocalVersionDirs,
  formatVersionDirName,
  parseVersionDirName,
  selectVersionDirNamesToDelete,
} from './version-dirs';

describe('version dir names', () => {
  test('parses plain and suffixed timestamp folders', () => {
    expect(parseVersionDirName('2026-08-07_23-15-01')).toEqual({
      base: '2026-08-07_23-15-01',
      ordinal: 1,
    });
    expect(parseVersionDirName('2026-08-07_23-15-01-2')).toEqual({
      base: '2026-08-07_23-15-01',
      ordinal: 2,
    });
    expect(parseVersionDirName('backup')).toBeNull();
    expect(parseVersionDirName('2026-08-07')).toBeNull();
  });

  test('formats suffixed names only after a collision', () => {
    expect(formatVersionDirName('2026-08-07_23-15-01')).toBe('2026-08-07_23-15-01');
    expect(formatVersionDirName('2026-08-07_23-15-01', 2)).toBe(
      '2026-08-07_23-15-01-2'
    );
  });

  test('sorts chronologically with numeric collision suffixes', () => {
    const names = [
      '2026-08-07_23-15-02-10',
      '2026-08-07_23-15-01',
      '2026-08-07_23-15-02-2',
      '2026-08-07_23-15-02',
    ];
    expect([...names].sort(compareVersionDirNames)).toEqual([
      '2026-08-07_23-15-01',
      '2026-08-07_23-15-02',
      '2026-08-07_23-15-02-2',
      '2026-08-07_23-15-02-10',
    ]);
  });

  test('keeps the newest folders, including suffixed ones', () => {
    const names = [
      '2026-08-07_23-15-01',
      '2026-08-07_23-15-01-2',
      '2026-08-07_23-15-01-10',
      '2026-08-07_23-15-02',
      'not-a-version',
    ];
    expect(selectVersionDirNamesToDelete(names, 2)).toEqual([
      '2026-08-07_23-15-01-2',
      '2026-08-07_23-15-01',
    ]);
  });

  test('never deletes the protected (just written) folder', () => {
    const names = [
      // A future-dated copy from a host with a fast clock.
      '2030-01-01_00-00-00',
      // The run that just finished after the clock was corrected.
      '2026-08-07_23-15-03',
    ];
    expect(selectVersionDirNamesToDelete(names, 1)).toEqual([
      '2026-08-07_23-15-03',
    ]);
    expect(
      selectVersionDirNamesToDelete(names, 1, ['2026-08-07_23-15-03'])
    ).toEqual([]);
  });

  test('protecting the normal newest folder does not keep an extra version', () => {
    const names = [
      '2026-08-07_23-15-01',
      '2026-08-07_23-15-02',
      '2026-08-07_23-15-03',
      '2026-08-07_23-15-04',
    ];
    expect(
      selectVersionDirNamesToDelete(names, 2, ['2026-08-07_23-15-04'])
    ).toEqual(['2026-08-07_23-15-02', '2026-08-07_23-15-01']);
  });
});

describe('local version folders', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-versions-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('never reuses an existing second: appends -2, -3 …', async () => {
    const first = await createUniqueLocalVersionDir(root, '2026-08-07_23-15-01');
    const second = await createUniqueLocalVersionDir(root, '2026-08-07_23-15-01');
    const third = await createUniqueLocalVersionDir(root, '2026-08-07_23-15-01');

    expect(path.basename(first)).toBe('2026-08-07_23-15-01');
    expect(path.basename(second)).toBe('2026-08-07_23-15-01-2');
    expect(path.basename(third)).toBe('2026-08-07_23-15-01-3');
    for (const dir of [first, second, third]) {
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    }
  });

  test('retention deletes oldest suffixed folders and returns their paths', async () => {
    const created: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      created.push(await createUniqueLocalVersionDir(root, '2026-08-07_23-15-01'));
    }
    await fs.writeFile(path.join(created[0]!, 'file.txt'), 'old');

    const deleted = await cleanupLocalVersionDirs(root, 2);

    expect(deleted.sort()).toEqual([created[0]!, created[1]!].sort());
    const remaining = (await fs.readdir(root)).sort();
    expect(remaining).toEqual(
      [path.basename(created[2]!), path.basename(created[3]!)].sort()
    );
  });

  test('a future-dated folder cannot make retention delete this run', async () => {
    // Simulate a copy created while the clock was ahead.
    const future = await createUniqueLocalVersionDir(root, '2030-01-01_00-00-00');
    await fs.writeFile(path.join(future, 'old.txt'), 'older backup');

    const current = await createUniqueLocalVersionDir(root, '2026-08-07_23-15-01');
    await fs.writeFile(path.join(current, 'new.txt'), 'fresh backup');

    const deleted = await cleanupLocalVersionDirs(root, 1, {
      protectedNames: [path.basename(current)],
    });

    expect(deleted).toEqual([]);
    expect(await fs.readFile(path.join(current, 'new.txt'), 'utf8')).toBe('fresh backup');
    expect(await fs.readFile(path.join(future, 'old.txt'), 'utf8')).toBe('older backup');
  });
});
