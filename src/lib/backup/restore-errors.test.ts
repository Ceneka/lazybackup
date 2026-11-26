import { describe, expect, test } from 'bun:test';
import {
  RestoreError,
  httpStatusForRestoreError,
  mapAgeDecryptError,
  mapS3DownloadError,
  translateRestoreWriteError,
} from './restore-errors';

describe('httpStatusForRestoreError', () => {
  test('uses typed status codes', () => {
    expect(httpStatusForRestoreError(new RestoreError('nope'))).toBe(400);
    expect(
      httpStatusForRestoreError(
        new RestoreError('gone', { statusCode: 404, code: 'not-found' })
      )
    ).toBe(404);
    expect(httpStatusForRestoreError(new Error('boom'))).toBe(500);
  });

  test('keeps a narrow fallback for peer retention errors', () => {
    expect(
      httpStatusForRestoreError(new Error('artifact removed by retention'))
    ).toBe(400);
  });
});

describe('translateRestoreWriteError', () => {
  test('turns EACCES/EPERM into a readable 400', () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const translated = translateRestoreWriteError(denied, '/srv/app');
    expect(translated).toBeInstanceOf(RestoreError);
    expect((translated as RestoreError).statusCode).toBe(400);
    expect(translated.message).toMatch(/Cannot write to restore target \/srv\/app/);
  });

  test('leaves unrelated errors alone', () => {
    const original = new Error('rsync failed');
    expect(translateRestoreWriteError(original, '/srv/app')).toBe(original);
  });
});

describe('mapS3DownloadError', () => {
  test('reports the full s3 path when the object is gone', () => {
    const error = Object.assign(new Error('The specified key does not exist.'), {
      name: 'NoSuchKey',
    });
    const mapped = mapS3DownloadError(error, 's3://bucket/app/dump.sql.gz');
    expect(mapped.message).toBe(
      'Backup artifact missing from S3: s3://bucket/app/dump.sql.gz'
    );
    expect((mapped as RestoreError).statusCode).toBe(400);
  });

  test('leaves network errors as-is', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    expect(mapS3DownloadError(error, 's3://bucket/x')).toBe(error);
  });
});

describe('mapAgeDecryptError', () => {
  test('names the artifact and explains vault/recovery keys', () => {
    const mapped = mapAgeDecryptError(new Error('age: no identity matched'), 'app.tar.gz.age');
    expect(mapped.message).toBe(
      'None of the keys in your vault (or recovery keys) can decrypt this backup: app.tar.gz.age'
    );
    expect((mapped as RestoreError).statusCode).toBe(400);
  });
});
