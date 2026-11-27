import { describe, expect, test } from 'bun:test';
import { combineBackupLog, LOG_SECTION, splitBackupLog } from './log-format';
import { transferLogMethod } from './index';

describe('instance backup log header', () => {
  test('instance methods map to their own section header', () => {
    expect(transferLogMethod('lazybackup-instance-file-local')).toBe(
      'lazybackup-instance'
    );
    expect(
      transferLogMethod('lazybackup-instance-passphrase-file-peer-mailbox-age')
    ).toBe('lazybackup-instance');
    // Existing mappings stay unchanged.
    expect(transferLogMethod('docker-file-local')).toBe('docker');
    expect(transferLogMethod('local-rsync')).toBe('local-rsync');
  });

  test('instance packs are not labelled as rsync transfers', () => {
    const log = combineBackupLog(
      '',
      'Source: LazyBackup instance (SQLite + age vault + SSH keys)\nWrap: age passphrase',
      transferLogMethod('lazybackup-instance-passphrase-file-local')
    );

    expect(log.startsWith(LOG_SECTION.transferInstance)).toBe(true);
    expect(log).toContain('Source: LazyBackup instance');
    expect(log).not.toContain(LOG_SECTION.transferRsync);
  });

  test('splitBackupLog recognises the instance header', () => {
    const log = combineBackupLog(
      '',
      'Source: LazyBackup instance\nWrap: none',
      'lazybackup-instance'
    );

    expect(splitBackupLog(log)).toEqual({
      transfer: 'Source: LazyBackup instance\nWrap: none',
    });
  });

  test('other transfer headers are unchanged', () => {
    expect(combineBackupLog('', 'x', 'docker').startsWith(LOG_SECTION.transferDocker)).toBe(
      true
    );
    expect(
      combineBackupLog('', 'x', 'database').startsWith(LOG_SECTION.transferDatabase)
    ).toBe(true);
    expect(combineBackupLog('', 'x', 'scp').startsWith(LOG_SECTION.transferScp)).toBe(true);
  });
});
