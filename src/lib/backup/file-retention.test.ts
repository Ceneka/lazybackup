import { describe, expect, test } from 'bun:test';
import { maxAgeToMs, selectFilesToDelete } from './file-retention';

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
