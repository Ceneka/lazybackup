import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_STALE_RUNNING_MS,
  selectStaleRunningIds,
  staleRunningErrorMessage,
} from './stale-running';

describe('selectStaleRunningIds', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  test('selects only old running rows', () => {
    const ids = selectStaleRunningIds(
      [
        {
          id: 'old',
          status: 'running',
          startTime: new Date(now.getTime() - DEFAULT_STALE_RUNNING_MS - 1000),
        },
        {
          id: 'fresh',
          status: 'running',
          startTime: new Date(now.getTime() - 60_000),
        },
        {
          id: 'done',
          status: 'success',
          startTime: new Date(now.getTime() - DEFAULT_STALE_RUNNING_MS * 2),
        },
      ],
      now
    );
    expect(ids).toEqual(['old']);
  });

  test('handles unix-second timestamps', () => {
    const startSec = Math.floor((now.getTime() - DEFAULT_STALE_RUNNING_MS - 5000) / 1000);
    expect(
      selectStaleRunningIds(
        [{ id: 'sec', status: 'running', startTime: startSec }],
        now
      )
    ).toEqual(['sec']);
  });
});

describe('staleRunningErrorMessage', () => {
  test('includes iso start time', () => {
    expect(staleRunningErrorMessage('2026-01-01T00:00:00.000Z')).toContain(
      '2026-01-01T00:00:00.000Z'
    );
  });
});
