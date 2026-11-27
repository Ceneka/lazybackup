import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  bucketNameSchema,
  validateBucketName,
  validateS3ProfileForWrite,
} from './bucket';

const originalAllowPrivate = process.env.ALLOW_PRIVATE_S3_ENDPOINTS;

beforeEach(() => {
  delete process.env.ALLOW_PRIVATE_S3_ENDPOINTS;
});

afterAll(() => {
  if (originalAllowPrivate === undefined) {
    delete process.env.ALLOW_PRIVATE_S3_ENDPOINTS;
  } else {
    process.env.ALLOW_PRIVATE_S3_ENDPOINTS = originalAllowPrivate;
  }
});

describe('validateBucketName', () => {
  test('accepts valid S3 bucket names', () => {
    for (const name of [
      'abc',
      'my-bucket',
      'my.bucket.2024',
      'a1.b2-c3',
      'bucket-123',
      'a'.repeat(63),
    ]) {
      expect(validateBucketName(name)).toEqual({ ok: true });
    }
  });

  test('rejects names outside 3..63 characters', () => {
    for (const name of ['', 'ab', 'a'.repeat(64)]) {
      const result = validateBucketName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('3 and 63');
    }
  });

  test('rejects uppercase, spaces, and underscores', () => {
    for (const name of ['Bad-Bucket', 'bad bucket name', 'bad_bucket']) {
      const result = validateBucketName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('lowercase');
    }
  });

  test('rejects names that start or end with a dot or hyphen', () => {
    for (const name of ['-bucket', 'bucket-', '.bucket', 'bucket.']) {
      const result = validateBucketName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('start and end');
    }
  });

  test('rejects consecutive dots and IPv4-shaped names', () => {
    for (const name of ['bucket..name', '192.168.1.1', '10.0.0.1', '999.999.999.999']) {
      const result = validateBucketName(name);
      expect(result.ok).toBe(false);
    }
  });
});

describe('bucketNameSchema', () => {
  test('wraps the same result as validateBucketName', () => {
    expect(bucketNameSchema.safeParse('my-bucket').success).toBe(true);
    const invalid = bucketNameSchema.safeParse('bad bucket name');
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]?.message).toContain('lowercase');
    }
  });
});

describe('validateS3ProfileForWrite endpoints', () => {
  function issuesFor(endpoint: string) {
    return validateS3ProfileForWrite({ bucket: 'my-bucket', endpoint });
  }

  test('blocks loopback and RFC1918 endpoints', () => {
    for (const endpoint of [
      'http://127.0.0.1:9000',
      'http://192.168.1.10:9000',
      'http://10.0.0.5:9000',
      'http://172.16.0.2:9000',
    ]) {
      const issues = issuesFor(endpoint);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.path).toEqual(['endpoint']);
      expect(issues[0]!.message).toContain('ALLOW_PRIVATE_S3_ENDPOINTS=true');
    }
  });

  test('blocks cloud metadata hosts even with the override', () => {
    process.env.ALLOW_PRIVATE_S3_ENDPOINTS = 'true';
    const issues = issuesFor('http://169.254.169.254/latest/meta-data/');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/metadata|SSRF/i);
  });

  test('allows public HTTPS endpoints', () => {
    expect(issuesFor('https://s3.amazonaws.com')).toEqual([]);
    expect(issuesFor('https://abc.r2.cloudflarestorage.com')).toEqual([]);
  });

  test('ALLOW_PRIVATE_S3_ENDPOINTS=true opts into LAN MinIO', () => {
    expect(issuesFor('http://127.0.0.1:9000')).toHaveLength(1);
    process.env.ALLOW_PRIVATE_S3_ENDPOINTS = 'true';
    expect(issuesFor('http://127.0.0.1:9000')).toEqual([]);
  });

  test('reports bucket and endpoint issues together', () => {
    const issues = validateS3ProfileForWrite({
      bucket: 'Bad Bucket',
      endpoint: 'http://127.0.0.1:9000',
    });
    expect(issues.map((issue) => issue.path[0])).toEqual(['bucket', 'endpoint']);
  });
});
