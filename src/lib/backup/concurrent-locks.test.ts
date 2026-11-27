import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_STALE_RUNNING_MS } from './stale-running';

type RunningRow = { id: string; status: string; startTime: Date };
let runningRows: RunningRow[] = [];

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findMany: async () => runningRows,
      },
    },
  },
}));

const {
  BackupRunningForRestoreError,
  RestoreAlreadyRunningError,
  RestoreRunningForBackupError,
  assertCanStartBackup,
  beginRestore,
  isBackupStartConflictError,
  resetRestoreLocksForTests,
  withBackupStartLock,
} = await import('./concurrent-run');

afterEach(() => {
  resetRestoreLocksForTests();
  runningRows = [];
});

describe('restore locks', () => {
  test('a second restore of the same history row is refused with a 409', async () => {
    const release = await beginRestore({ historyId: 'h1', configId: 'cfg-1' });

    try {
      await expect(
        beginRestore({ historyId: 'h1', configId: 'cfg-1' })
      ).rejects.toBeInstanceOf(RestoreAlreadyRunningError);
      try {
        await beginRestore({ historyId: 'h1', configId: 'cfg-1' });
      } catch (error) {
        expect((error as InstanceType<typeof RestoreAlreadyRunningError>).statusCode).toBe(
          409
        );
      }
    } finally {
      release();
    }

    const again = await beginRestore({ historyId: 'h1', configId: 'cfg-1' });
    again();
  });

  test('a second restore of the same config (different run) is refused', async () => {
    const release = await beginRestore({ historyId: 'h1a', configId: 'cfg-1' });

    try {
      await expect(
        beginRestore({ historyId: 'h1b', configId: 'cfg-1' })
      ).rejects.toBeInstanceOf(RestoreAlreadyRunningError);
      try {
        await beginRestore({ historyId: 'h1b', configId: 'cfg-1' });
      } catch (error) {
        expect((error as InstanceType<typeof RestoreAlreadyRunningError>).historyId).toBe(
          'h1a'
        );
      }

      // A restore of another config is independent.
      const other = await beginRestore({ historyId: 'h2', configId: 'cfg-2' });
      other();
    } finally {
      release();
    }

    const again = await beginRestore({ historyId: 'h1b', configId: 'cfg-1' });
    again();
  });

  test('restore is refused while a fresh backup of the config is running', async () => {
    runningRows = [
      { id: 'hist-run', status: 'running', startTime: new Date(Date.now() - 1000) },
    ];

    await expect(
      beginRestore({ historyId: 'h2', configId: 'cfg-1' })
    ).rejects.toBeInstanceOf(BackupRunningForRestoreError);
  });

  test('stale running backups do not block restores', async () => {
    runningRows = [
      {
        id: 'hist-stale',
        status: 'running',
        startTime: new Date(Date.now() - DEFAULT_STALE_RUNNING_MS - 60_000),
      },
    ];

    const release = await beginRestore({ historyId: 'h3', configId: 'cfg-1' });
    release();
  });

  test('starting a backup is refused while a restore of that config runs', async () => {
    const release = await beginRestore({ historyId: 'h4', configId: 'cfg-1' });
    try {
      await expect(assertCanStartBackup('cfg-1')).rejects.toBeInstanceOf(
        RestoreRunningForBackupError
      );
      await expect(assertCanStartBackup('cfg-1')).rejects.toMatchObject({
        statusCode: 409,
      });
    } finally {
      release();
    }

    await assertCanStartBackup('cfg-1');
  });

  test('conflict helper recognises both backup-start conflicts', () => {
    expect(isBackupStartConflictError(new RestoreRunningForBackupError('h'))).toBe(true);
  });
});

describe('withBackupStartLock', () => {
  test('serializes check-then-insert so the second start sees the first', async () => {
    const events: string[] = [];
    let running = false;

    const start = (name: string) =>
      withBackupStartLock('cfg-1', async () => {
        if (running) throw new Error('already running');
        running = true;
        events.push(`${name}:insert`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push(`${name}:inserted`);
      });

    const results = await Promise.allSettled([start('first'), start('second')]);

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    // The second start only runs its check after the first insert finished.
    expect(events).toEqual(['first:insert', 'first:inserted']);
  });

  test('releases the lock after a failed start', async () => {
    await expect(
      withBackupStartLock('cfg-1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    await expect(
      withBackupStartLock('cfg-1', async () => 'ok')
    ).resolves.toBe('ok');
  });
});
