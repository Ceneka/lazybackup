import { describe, expect, test } from 'bun:test';
import { historyBackupConfigWith } from './history-query';

describe('historyBackupConfigWith', () => {
  test('excludes backup-config secrets', () => {
    expect(historyBackupConfigWith.columns).toEqual({
      dbPassword: false,
      instanceBackupPassphrase: false,
    });
  });

  test('allowlists nested server columns without secrets', () => {
    const cols = historyBackupConfigWith.with.server.columns;
    expect(cols).toMatchObject({ id: true, name: true });
    expect(cols).not.toHaveProperty('password');
    expect(cols).not.toHaveProperty('privateKey');
    expect(historyBackupConfigWith.with.destinationServer.columns).not.toHaveProperty(
      'password'
    );
  });

  test('allowlists nested S3 columns without secrets', () => {
    const cols = historyBackupConfigWith.with.sourceS3Profile.columns;
    expect(cols).toMatchObject({ id: true, name: true, bucket: true });
    expect(cols).not.toHaveProperty('secretAccessKey');
    expect(cols).not.toHaveProperty('accessKeyId');
    expect(
      historyBackupConfigWith.with.destinationS3Profile.columns
    ).not.toHaveProperty('secretAccessKey');
  });
});
