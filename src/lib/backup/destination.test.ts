import { describe, expect, test } from 'bun:test';
import {
  destinationCompareKey,
  destinationsAreSame,
  destinationsNest,
  findExactConflictInList,
  findNestedOverlapsInList,
  getSuggestStorageRoot,
  slugifyName,
  suggestDestinationPath,
} from './destination';

describe('slugifyName', () => {
  test('lowercases and replaces non-alnum', () => {
    expect(slugifyName('My Site!')).toBe('my-site');
  });

  test('collapses dashes and trims edges', () => {
    expect(slugifyName('  --Foo__Bar--  ')).toBe('foo-bar');
  });

  test('falls back when empty', () => {
    expect(slugifyName('@@@')).toBe('backup');
    expect(slugifyName('')).toBe('backup');
  });
});

describe('getSuggestStorageRoot', () => {
  test('maps relative default to /backups', () => {
    expect(getSuggestStorageRoot('./backups')).toBe('/backups');
    expect(getSuggestStorageRoot('backups')).toBe('/backups');
    expect(getSuggestStorageRoot(undefined)).toBe('/backups');
  });

  test('keeps absolute roots', () => {
    expect(getSuggestStorageRoot('/data/backups/')).toBe('/data/backups');
  });
});

describe('suggestDestinationPath', () => {
  test('builds storage/server/backup path', () => {
    expect(
      suggestDestinationPath({
        serverName: 'Prod VPS',
        backupName: 'WordPress',
        storageRoot: '/backups',
      })
    ).toBe('/backups/prod-vps/wordpress');
  });
});

describe('destination comparison', () => {
  test('ignores trailing slashes', () => {
    expect(destinationsAreSame('/backups/foo', '/backups/foo/')).toBe(true);
    expect(destinationCompareKey('/backups/foo/')).toBe('/backups/foo');
  });

  test('detects nested paths', () => {
    expect(destinationsNest('/backups/a', '/backups/a/b')).toBe(true);
    expect(destinationsNest('/backups/a/b', '/backups/a')).toBe(true);
    expect(destinationsNest('/backups/a', '/backups/a')).toBe(false);
    expect(destinationsNest('/backups/a', '/backups/ab')).toBe(false);
  });
});

describe('findExactConflictInList', () => {
  const configs = [
    { id: '1', name: 'Alpha', destinationPath: '/backups/alpha' },
    { id: '2', name: 'Beta', destinationPath: '/backups/beta/' },
  ];

  test('finds exact conflict', () => {
    expect(findExactConflictInList(configs, '/backups/beta')).toEqual({
      id: '2',
      name: 'Beta',
    });
  });

  test('excludes self', () => {
    expect(findExactConflictInList(configs, '/backups/beta', '2')).toBeNull();
  });

  test('returns null when free', () => {
    expect(findExactConflictInList(configs, '/backups/gamma')).toBeNull();
  });
});

describe('findNestedOverlapsInList', () => {
  const configs = [
    { id: '1', name: 'Parent', destinationPath: '/backups/site' },
    { id: '2', name: 'Other', destinationPath: '/backups/other' },
  ];

  test('finds nested overlaps', () => {
    expect(findNestedOverlapsInList(configs, '/backups/site/uploads')).toEqual([
      { id: '1', name: 'Parent' },
    ]);
  });

  test('excludes self and ignores exact matches', () => {
    expect(findNestedOverlapsInList(configs, '/backups/site', '1')).toEqual([]);
  });
});

describe('remote destination conflicts', () => {
  const configs = [
    {
      id: '1',
      name: 'Local',
      destinationPath: '/backups/shared',
      destinationKind: 'local' as const,
      destinationServerId: null,
    },
    {
      id: '2',
      name: 'Remote A',
      destinationPath: '/backups/shared',
      destinationKind: 'server' as const,
      destinationServerId: 'srv-a',
    },
    {
      id: '3',
      name: 'Remote B',
      destinationPath: '/data/out',
      destinationKind: 'server' as const,
      destinationServerId: 'srv-b',
    },
  ];

  test('same path on local vs remote does not conflict', () => {
    expect(
      findExactConflictInList(configs, '/backups/shared', undefined, {
        destinationKind: 'server',
        destinationServerId: 'srv-new',
      })
    ).toBeNull();
  });

  test('same path on same remote server conflicts', () => {
    expect(
      findExactConflictInList(configs, '/backups/shared/', undefined, {
        destinationKind: 'server',
        destinationServerId: 'srv-a',
      })
    ).toEqual({ id: '2', name: 'Remote A' });
  });

  test('same path on different remote servers does not conflict', () => {
    expect(
      findExactConflictInList(configs, '/data/out', undefined, {
        destinationKind: 'server',
        destinationServerId: 'srv-a',
      })
    ).toBeNull();
  });
});
