import { describe, expect, test } from 'bun:test';
import { formatS3ConnectionError, normalizeS3ProfileFields } from './normalize';
import { s3ProfileSchema } from './schema';

describe('normalizeS3ProfileFields', () => {
  test('trims bucket, keys, and trailing slash on endpoint', () => {
    const next = normalizeS3ProfileFields({
      endpoint: 'https://abc.r2.cloudflarestorage.com/ ',
      region: ' us-east-1 ',
      bucket: ' lazybackup-data',
      accessKeyId: ' AKIA ',
      secretAccessKey: ' secret ',
    });
    expect(next.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    expect(next.region).toBe('us-east-1');
    expect(next.bucket).toBe('lazybackup-data');
    expect(next.accessKeyId).toBe('AKIA');
    expect(next.secretAccessKey).toBe('secret');
  });

  test('strips a bucket pasted into the endpoint path', () => {
    const next = normalizeS3ProfileFields({
      endpoint: 'https://abc.r2.cloudflarestorage.com/lazybackup-data',
      region: 'auto',
      bucket: 'lazybackup-data',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    });
    expect(next.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    expect(next.bucket).toBe('lazybackup-data');
  });
});

describe('s3ProfileSchema', () => {
  test('trims a leading space on the bucket name', () => {
    const parsed = s3ProfileSchema.parse({
      name: ' R2 ',
      endpoint: 'https://abc.r2.cloudflarestorage.com/',
      region: 'us-east-1',
      bucket: ' lazybackup-data',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });
    expect(parsed.name).toBe('R2');
    expect(parsed.endpoint).toBe('https://abc.r2.cloudflarestorage.com');
    expect(parsed.bucket).toBe('lazybackup-data');
  });
});

describe('formatS3ConnectionError', () => {
  test('adds a hint for Access Denied', () => {
    expect(formatS3ConnectionError(new Error('Access Denied'))).toMatch(/extra spaces/i);
  });
});
