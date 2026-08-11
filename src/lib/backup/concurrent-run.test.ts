import { describe, expect, test } from 'bun:test';
import {
  BackupAlreadyRunningError,
  findActiveRunningEntry,
  isBackupAlreadyRunningError,
} from './concurrent-run';
import { DEFAULT_STALE_RUNNING_MS } from './stale-running';

describe('findActiveRunningEntry', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  test('returns null when no running rows', () => {
    expect(
      findActiveRunningEntry(
        [{ id: 'a', status: 'success', startTime: now }],
        now
      )
    ).toBeNull();
  });

  test('returns fresh running row', () => {
    const fresh = {
      id: 'fresh',
      status: 'running' as const,
      startTime: new Date(now.getTime() - 60_000),
    };
    expect(findActiveRunningEntry([fresh], now)).toEqual(fresh);
  });

  test('ignores stale running rows', () => {
    const stale = {
      id: 'stale',
      status: 'running' as const,
      startTime: new Date(now.getTime() - DEFAULT_STALE_RUNNING_MS - 1000),
    };
    expect(findActiveRunningEntry([stale], now)).toBeNull();
  });

  test('prefers the newest non-stale running row', () => {
    const older = {
      id: 'older',
      status: 'running' as const,
      startTime: new Date(now.getTime() - 120_000),
    };
    const newer = {
      id: 'newer',
      status: 'running' as const,
      startTime: new Date(now.getTime() - 30_000),
    };
    expect(findActiveRunningEntry([older, newer], now)?.id).toBe('newer');
  });
});

describe('BackupAlreadyRunningError', () => {
  test('isBackupAlreadyRunningError narrows', () => {
    const err = new BackupAlreadyRunningError('h1', new Date());
    expect(isBackupAlreadyRunningError(err)).toBe(true);
    expect(isBackupAlreadyRunningError(new Error('nope'))).toBe(false);
    expect(err.historyId).toBe('h1');
  });
});
