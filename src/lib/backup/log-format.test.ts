import { describe, expect, test } from 'bun:test';
import {
  LOG_SECTION,
  buildFileRetentionLog,
  buildPeerRetentionLog,
  buildPreBackupLog,
  combineBackupLog,
  formatPreBackupCommandLog,
  splitBackupLog,
} from './log-format';

describe('formatPreBackupCommandLog', () => {
  test('includes command, exit code, stdout, and stderr', () => {
    const log = formatPreBackupCommandLog('bash /tmp/backup.sh', {
      stdout: 'backup complete',
      stderr: 'minor warning',
      code: 0,
    });

    expect(log).toBe(
      [
        '$ bash /tmp/backup.sh',
        'exit code: 0',
        '--- stdout ---',
        'backup complete',
        '--- stderr ---',
        'minor warning',
      ].join('\n')
    );
  });

  test('shows placeholder when command produces no output', () => {
    const log = formatPreBackupCommandLog('true', {
      stdout: '',
      stderr: '   ',
      code: 0,
    });

    expect(log).toContain('(no output)');
    expect(log).not.toContain('--- stdout ---');
    expect(log).not.toContain('--- stderr ---');
  });

  test('uses unknown when exit code is missing', () => {
    const log = formatPreBackupCommandLog('echo hi', {
      stdout: 'hi',
      stderr: '',
    });

    expect(log).toContain('exit code: unknown');
  });
});

describe('buildPreBackupLog', () => {
  test('returns empty string for no commands', () => {
    expect(buildPreBackupLog([])).toBe('');
  });

  test('wraps command logs with the pre-backup section header', () => {
    const commandLog = formatPreBackupCommandLog('bash /tmp/backup.sh', {
      stdout: 'ok',
      stderr: '',
      code: 0,
    });

    const log = buildPreBackupLog([commandLog]);

    expect(log.startsWith(LOG_SECTION.preBackup)).toBe(true);
    expect(log).toContain('$ bash /tmp/backup.sh');
  });

  test('separates multiple command logs with a blank line', () => {
    const first = formatPreBackupCommandLog('echo one', {
      stdout: 'one',
      stderr: '',
      code: 0,
    });
    const second = formatPreBackupCommandLog('echo two', {
      stdout: 'two',
      stderr: '',
      code: 0,
    });

    const log = buildPreBackupLog([first, second]);

    expect(log).toContain('$ echo one\nexit code: 0\n--- stdout ---\none\n\n$ echo two');
  });
});

describe('combineBackupLog', () => {
  test('combines pre-backup and rsync output with section headers', () => {
    const preBackupLog = buildPreBackupLog([
      formatPreBackupCommandLog('bash /tmp/backup.sh', {
        stdout: 'done',
        stderr: '',
        code: 0,
      }),
    ]);

    const combined = combineBackupLog(preBackupLog, 'Number of files: 42', 'rsync');

    expect(combined).toContain(LOG_SECTION.preBackup);
    expect(combined).toContain(LOG_SECTION.transferRsync);
    expect(combined).toContain('Number of files: 42');
    expect(combined.indexOf(LOG_SECTION.preBackup)).toBeLessThan(
      combined.indexOf(LOG_SECTION.transferRsync)
    );
  });

  test('uses scp transfer header when method is scp', () => {
    const combined = combineBackupLog('', 'SCP Backup Summary', 'scp');

    expect(combined.startsWith(LOG_SECTION.transferScp)).toBe(true);
    expect(combined).toContain('SCP Backup Summary');
  });

  test('omits pre-backup section when no commands ran', () => {
    const combined = combineBackupLog('', 'rsync output', 'rsync');

    expect(combined).not.toContain(LOG_SECTION.preBackup);
    expect(combined).toContain(LOG_SECTION.transferRsync);
  });

  test('appends file retention section when provided', () => {
    const retentionLog = buildFileRetentionLog(['old.dump']);
    const combined = combineBackupLog('', 'rsync output', 'rsync', retentionLog);

    expect(combined).toContain(LOG_SECTION.transferRsync);
    expect(combined).toContain(LOG_SECTION.fileRetention);
    expect(combined).toContain('- old.dump');
    expect(combined.indexOf(LOG_SECTION.transferRsync)).toBeLessThan(
      combined.indexOf(LOG_SECTION.fileRetention)
    );
  });
});

describe('buildFileRetentionLog', () => {
  test('returns empty string when nothing was deleted', () => {
    expect(buildFileRetentionLog([])).toBe('');
  });

  test('lists deleted files under the retention header', () => {
    const log = buildFileRetentionLog(['a.dump', 'b.dump']);

    expect(log.startsWith(LOG_SECTION.fileRetention)).toBe(true);
    expect(log).toContain('Deleted 2 file(s):');
    expect(log).toContain('- a.dump');
    expect(log).toContain('- b.dump');
  });
});

describe('buildPeerRetentionLog', () => {
  test('returns empty string when nothing was queued', () => {
    expect(buildPeerRetentionLog([])).toBe('');
  });

  test('lists queued bro object keys under the retention header', () => {
    const log = buildPeerRetentionLog(['old.sql.gz.age']);
    expect(log.startsWith(LOG_SECTION.fileRetention)).toBe(true);
    expect(log).toContain('Queued 1 object(s) for bro deletion:');
    expect(log).toContain('- old.sql.gz.age');
  });
});

describe('splitBackupLog', () => {
  test('round-trips combined pre-backup and transfer logs', () => {
    const preBackupLog = buildPreBackupLog([
      formatPreBackupCommandLog('bash /tmp/backup.sh', {
        stdout: 'done',
        stderr: 'warn',
        code: 0,
      }),
    ]);
    const combined = combineBackupLog(preBackupLog, 'sent 1,234 bytes', 'rsync');

    expect(splitBackupLog(combined)).toEqual({
      preBackup: '$ bash /tmp/backup.sh\nexit code: 0\n--- stdout ---\ndone\n--- stderr ---\nwarn',
      transfer: 'sent 1,234 bytes',
    });
  });

  test('returns transfer-only logs for legacy history entries', () => {
    const legacy = 'Number of files: 10\nTotal file size: 500';

    expect(splitBackupLog(legacy)).toEqual({ transfer: legacy });
  });

  test('splits transfer-only logs that use the new header format', () => {
    const combined = combineBackupLog('', 'rsync stats', 'rsync');

    expect(splitBackupLog(combined)).toEqual({ transfer: 'rsync stats' });
  });

  test('splits scp transfer logs', () => {
    const combined = combineBackupLog(
      buildPreBackupLog([
        formatPreBackupCommandLog('true', { stdout: '', stderr: '', code: 0 }),
      ]),
      'SCP Backup Summary',
      'scp'
    );

    expect(splitBackupLog(combined)).toEqual({
      preBackup: '$ true\nexit code: 0\n(no output)',
      transfer: 'SCP Backup Summary',
    });
  });

  test('separates file retention from transfer output', () => {
    const retentionLog = buildFileRetentionLog(['stale.dump']);
    const combined = combineBackupLog('', 'rsync stats', 'rsync', retentionLog);

    expect(splitBackupLog(combined)).toEqual({
      transfer: 'rsync stats',
      fileRetention: 'Deleted 1 file(s):\n- stale.dump',
    });
  });

  test('splits docker volume transfer logs', () => {
    const combined = combineBackupLog('', 'Volume: data\nArchive: data.tar.gz', 'docker');
    const parts = splitBackupLog(combined);
    expect(parts.transfer).toContain('Volume: data');
    expect(parts.preBackup).toBeUndefined();
  });

  test('splits database dump transfer logs', () => {
    const combined = combineBackupLog('', 'Engine: postgres\nDatabase: app', 'database');
    expect(combined).toContain(LOG_SECTION.transferDatabase);
    const parts = splitBackupLog(combined);
    expect(parts.transfer).toContain('Engine: postgres');
  });
});
