import { describe, expect, test } from 'bun:test';
import {
  maxAgeToMs,
  selectFilesToDelete,
  isBackupArtifactFileName,
  relativeKeyUnderPrefix,
  selectPeerKeysForFileRetention,
  selectPeerKeysForVersionRetention,
} from './file-retention';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-07T12:00:00.000Z');

function file(name: string, ageDays: number) {
  return { name, mtimeMs: NOW - ageDays * DAY_MS };
}

describe('maxAgeToMs', () => {
  test('converts days', () => {
    expect(maxAgeToMs(1, 'days')).toBe(DAY_MS);
    expect(maxAgeToMs(30, 'days')).toBe(30 * DAY_MS);
  });

  test('converts months as 30-day months', () => {
    expect(maxAgeToMs(1, 'months')).toBe(30 * DAY_MS);
    expect(maxAgeToMs(2, 'months')).toBe(60 * DAY_MS);
  });
});

describe('selectFilesToDelete', () => {
  test('keeps newest minKeep even when all files are old', () => {
    const files = [
      file('a.dump', 100),
      file('b.dump', 90),
      file('c.dump', 80),
    ];

    const toDelete = selectFilesToDelete(files, {
      maxAge: 7,
      unit: 'days',
      minKeep: 2,
      nowMs: NOW,
    });

    expect(toDelete).toEqual(['a.dump']);
  });

  test('does not delete files younger than max age', () => {
    const files = [
      file('new.dump', 1),
      file('mid.dump', 10),
      file('old.dump', 40),
    ];

    const toDelete = selectFilesToDelete(files, {
      maxAge: 30,
      unit: 'days',
      minKeep: 1,
      nowMs: NOW,
    });

    expect(toDelete).toEqual(['old.dump']);
  });

  test('deletes nothing when file count is at or below minKeep', () => {
    const files = [file('a.dump', 100), file('b.dump', 90)];

    const toDelete = selectFilesToDelete(files, {
      maxAge: 1,
      unit: 'days',
      minKeep: 5,
      nowMs: NOW,
    });

    expect(toDelete).toEqual([]);
  });

  test('supports month-based age', () => {
    const files = [
      file('keep.dump', 10),
      file('old.dump', 100),
    ];

    const toDelete = selectFilesToDelete(files, {
      maxAge: 2,
      unit: 'months',
      minKeep: 1,
      nowMs: NOW,
    });

    expect(toDelete).toEqual(['old.dump']);
  });

  test('returns empty list for empty input', () => {
    expect(
      selectFilesToDelete([], {
        maxAge: 30,
        unit: 'days',
        minKeep: 5,
        nowMs: NOW,
      })
    ).toEqual([]);
  });
});

describe('isBackupArtifactFileName', () => {
  test('accepts dump and archive names', () => {
    expect(isBackupArtifactFileName('appdb.sql.gz')).toBe(true);
    expect(isBackupArtifactFileName('vol.tar.gz')).toBe(true);
    expect(isBackupArtifactFileName('vol.tar.gz.age')).toBe(true);
    expect(isBackupArtifactFileName('lazybackup-instance-x.tar.gz.age')).toBe(true);
  });

  test('rejects unrelated top-level files', () => {
    expect(isBackupArtifactFileName('notes.txt')).toBe(false);
    expect(isBackupArtifactFileName('README')).toBe(false);
    expect(isBackupArtifactFileName('.env')).toBe(false);
  });
});

describe('selectPeerKeysForFileRetention', () => {
  test('selects top-level dump keys under a prefix using age + minKeep', () => {
    const objects = [
      { key: 'app/keep.sql.gz.age', mtimeMs: NOW - 1 * DAY_MS },
      { key: 'app/mid.sql.gz.age', mtimeMs: NOW - 10 * DAY_MS },
      { key: 'app/old.sql.gz.age', mtimeMs: NOW - 40 * DAY_MS },
      { key: 'app/nested/skip.sql.gz.age', mtimeMs: NOW - 40 * DAY_MS },
      { key: 'other/old.sql.gz.age', mtimeMs: NOW - 40 * DAY_MS },
    ];

    expect(
      selectPeerKeysForFileRetention(objects, 'app', {
        maxAge: 30,
        unit: 'days',
        minKeep: 1,
        nowMs: NOW,
      })
    ).toEqual(['app/old.sql.gz.age']);
  });

  test('keeps newest minKeep peer artifacts even when all are old', () => {
    const objects = [
      { key: 'a.sql.gz', mtimeMs: NOW - 100 * DAY_MS },
      { key: 'b.sql.gz', mtimeMs: NOW - 90 * DAY_MS },
      { key: 'c.sql.gz', mtimeMs: NOW - 80 * DAY_MS },
    ];

    expect(
      selectPeerKeysForFileRetention(objects, '', {
        maxAge: 7,
        unit: 'days',
        minKeep: 2,
        nowMs: NOW,
      })
    ).toEqual(['a.sql.gz']);
  });
});

describe('selectPeerKeysForVersionRetention', () => {
  test('keeps newest N timestamp prefixes and returns keys in older versions', () => {
    const objects = [
      { key: 'db/2026-08-01_00-00-00/app.sql.gz.age', mtimeMs: NOW - 12 * DAY_MS },
      { key: 'db/2026-08-05_00-00-00/app.sql.gz.age', mtimeMs: NOW - 8 * DAY_MS },
      { key: 'db/2026-08-10_00-00-00/app.sql.gz.age', mtimeMs: NOW - 3 * DAY_MS },
      { key: 'db/notes.txt', mtimeMs: NOW },
    ];

    expect(selectPeerKeysForVersionRetention(objects, 'db', 2)).toEqual([
      'db/2026-08-01_00-00-00/app.sql.gz.age',
    ]);
  });

  test('returns empty when version count is at or below keep', () => {
    const objects = [
      { key: '2026-08-01_00-00-00/vol.tar.gz.age', mtimeMs: 1 },
      { key: '2026-08-02_00-00-00/vol.tar.gz.age', mtimeMs: 2 },
    ];
    expect(selectPeerKeysForVersionRetention(objects, '', 2)).toEqual([]);
  });
});

describe('relativeKeyUnderPrefix', () => {
  test('strips a matching prefix', () => {
    expect(relativeKeyUnderPrefix('app/obj.age', 'app')).toBe('obj.age');
    expect(relativeKeyUnderPrefix('obj.age', '')).toBe('obj.age');
    expect(relativeKeyUnderPrefix('other/obj.age', 'app')).toBeNull();
  });
});
