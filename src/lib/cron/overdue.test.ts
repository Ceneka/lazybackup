import { describe, expect, test } from 'bun:test'
import { estimateCronIntervalMs, isScheduleOverdue } from './overdue'

describe('estimateCronIntervalMs', () => {
  test('daily is about 24h', () => {
    const ms = estimateCronIntervalMs('0 2 * * *', 'UTC')
    expect(ms).toBe(24 * 60 * 60 * 1000)
  })

  test('hourly is 1h', () => {
    const ms = estimateCronIntervalMs('0 * * * *', 'UTC')
    expect(ms).toBe(60 * 60 * 1000)
  })

  test('invalid cron is null', () => {
    expect(estimateCronIntervalMs('not cron', 'UTC')).toBeNull()
  })
})

describe('isScheduleOverdue', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')

  test('not overdue when last run is recent', () => {
    const last = new Date('2026-08-13T10:00:00.000Z')
    expect(isScheduleOverdue('0 * * * *', last, now, 'UTC')).toBe(false)
  })

  test('overdue when last run is older than interval plus 2h grace', () => {
    const last = new Date('2026-08-13T08:00:00.000Z')
    expect(isScheduleOverdue('0 * * * *', last, now, 'UTC')).toBe(true)
  })

  test('never-run uses createdAt', () => {
    const created = new Date('2026-08-10T12:00:00.000Z')
    expect(isScheduleOverdue('0 2 * * *', null, now, 'UTC', created)).toBe(true)
  })

  test('never-run and recent createdAt is not overdue', () => {
    const created = new Date('2026-08-13T11:00:00.000Z')
    expect(isScheduleOverdue('0 2 * * *', null, now, 'UTC', created)).toBe(false)
  })

  test('invalid schedule is never overdue', () => {
    expect(
      isScheduleOverdue('bad', new Date('2000-01-01'), now, 'UTC')
    ).toBe(false)
  })
})
