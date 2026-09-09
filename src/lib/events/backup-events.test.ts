import { describe, expect, test } from 'bun:test';
import { emitBackupEvent, subscribeBackupEvents, type BackupEvent } from './backup-events';

function sample(overrides: Partial<BackupEvent> = {}): BackupEvent {
  return {
    type: 'backup.finished',
    historyId: 'h1',
    configId: 'c1',
    backupName: 'Daily',
    status: 'success',
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('backup-events', () => {
  test('delivers events to subscribers', () => {
    const received: BackupEvent[] = [];
    const unsub = subscribeBackupEvents((e) => received.push(e));
    const event = sample();
    emitBackupEvent(event);
    expect(received).toEqual([event]);
    unsub();
  });

  test('unsubscribe stops delivery', () => {
    const received: BackupEvent[] = [];
    const unsub = subscribeBackupEvents((e) => received.push(e));
    unsub();
    emitBackupEvent(sample({ historyId: 'h2' }));
    expect(received).toEqual([]);
  });

  test('multiple subscribers all receive the event', () => {
    const a: BackupEvent[] = [];
    const b: BackupEvent[] = [];
    const unsubA = subscribeBackupEvents((e) => a.push(e));
    const unsubB = subscribeBackupEvents((e) => b.push(e));
    const event = sample({ type: 'backup.started', status: 'running' });
    emitBackupEvent(event);
    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
    unsubA();
    unsubB();
  });
});
