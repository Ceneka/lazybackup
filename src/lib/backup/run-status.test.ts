import { describe, expect, test } from 'bun:test'
import {
  formatRelativeTime,
  pickActiveRunningRun,
  toLatestRunSummary,
} from './run-status'

const now = new Date('2026-11-21T12:00:00.000Z')

describe('formatRelativeTime', () => {
  test('formats recent and older past times', () => {
    expect(formatRelativeTime('2026-11-21T11:59:55.000Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-11-21T11:59:30.000Z', now)).toBe('30s ago')
    expect(formatRelativeTime('2026-11-21T11:48:00.000Z', now)).toBe('12m ago')
    expect(formatRelativeTime('2026-11-21T09:00:00.000Z', now)).toBe('3h ago')
    expect(formatRelativeTime('2026-11-18T12:00:00.000Z', now)).toBe('3d ago')
    expect(formatRelativeTime('2026-09-21T12:00:00.000Z', now)).toBe('2mo ago')
    expect(formatRelativeTime('2025-11-21T12:00:00.000Z', now)).toBe('1y ago')
  })

  test('formats future times with "in"', () => {
    expect(formatRelativeTime('2026-11-21T12:05:00.000Z', now)).toBe('in 5m')
    expect(formatRelativeTime('2026-11-21T14:00:00.000Z', now)).toBe('in 2h')
  })

  test('accepts Date and unix-second timestamps', () => {
    expect(formatRelativeTime(new Date('2026-11-21T11:00:00.000Z'), now)).toBe('1h ago')
    expect(formatRelativeTime(Math.floor(now.getTime() / 1000) - 60, now)).toBe('1m ago')
  })

  test('falls back for invalid values', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('—')
  })
})

describe('pickActiveRunningRun', () => {
  test('returns the newest non-stale running row', () => {
    const rows = [
      { id: 'old', status: 'running', startTime: '2026-11-21T09:00:00.000Z' },
      { id: 'new', status: 'running', startTime: '2026-11-21T11:50:00.000Z' },
      { id: 'done', status: 'success', startTime: '2026-11-21T11:55:00.000Z' },
    ]
    expect(pickActiveRunningRun(rows, now)?.id).toBe('new')
  })

  test('ignores running rows older than the stale cutoff', () => {
    const rows = [
      { id: 'stale', status: 'running', startTime: '2026-11-20T00:00:00.000Z' },
    ]
    expect(pickActiveRunningRun(rows, now)).toBeNull()
  })

  test('returns null when nothing is running', () => {
    expect(
      pickActiveRunningRun(
        [{ id: 'done', status: 'failed', startTime: '2026-11-21T11:00:00.000Z' }],
        now
      )
    ).toBeNull()
  })
})

describe('toLatestRunSummary', () => {
  test('normalizes dates and trims the error snippet', () => {
    const summary = toLatestRunSummary({
      id: 'h1',
      status: 'failed',
      startTime: new Date('2026-11-21T10:00:00.000Z'),
      endTime: new Date('2026-11-21T10:01:00.000Z'),
      errorMessage: `  rsync failed\n  with code 23  `,
    })
    expect(summary).toEqual({
      id: 'h1',
      status: 'failed',
      startTime: '2026-11-21T10:00:00.000Z',
      endTime: '2026-11-21T10:01:00.000Z',
      errorSnippet: 'rsync failed with code 23',
    })
  })

  test('keeps null endTime and error snippet for a running row', () => {
    const summary = toLatestRunSummary({
      id: 'h2',
      status: 'running',
      startTime: '2026-11-21T10:00:00.000Z',
      endTime: null,
      errorMessage: null,
    })
    expect(summary.endTime).toBeNull()
    expect(summary.errorSnippet).toBeNull()
  })
})
