import { describe, expect, test } from 'bun:test';
import {
  assertAddressAllowed,
  assertS3EndpointHostSync,
  classifyHostname,
  classifyIpAddress,
  parseS3EndpointUrl,
} from './endpoint';

describe('classifyIpAddress', () => {
  test('loopback and link-local / metadata', () => {
    expect(classifyIpAddress('127.0.0.1')).toBe('loopback');
    expect(classifyIpAddress('::1')).toBe('loopback');
    expect(classifyIpAddress('169.254.169.254')).toBe('metadata');
    expect(classifyIpAddress('169.254.1.1')).toBe('link-local');
  });

  test('private ranges', () => {
    expect(classifyIpAddress('10.0.0.5')).toBe('private');
    expect(classifyIpAddress('192.168.1.10')).toBe('private');
    expect(classifyIpAddress('172.16.0.1')).toBe('private');
    expect(classifyIpAddress('100.64.1.1')).toBe('private');
  });

  test('public', () => {
    expect(classifyIpAddress('1.1.1.1')).toBe('public');
    expect(classifyIpAddress('8.8.8.8')).toBe('public');
  });
});

describe('classifyHostname', () => {
  test('localhost and metadata names', () => {
    expect(classifyHostname('localhost')).toBe('loopback');
    expect(classifyHostname('metadata.google.internal')).toBe('metadata');
  });
});

describe('assertS3EndpointHostSync', () => {
  test('blocks metadata IP', () => {
    expect(() => assertS3EndpointHostSync('http://169.254.169.254/latest/meta-data/')).toThrow(
      /metadata|link-local/i
    );
  });

  test('blocks loopback MinIO unless allowPrivate', () => {
    expect(() => assertS3EndpointHostSync('http://127.0.0.1:9000')).toThrow(/private|loopback/i);
    expect(() =>
      assertS3EndpointHostSync('http://127.0.0.1:9000', { allowPrivate: true })
    ).not.toThrow();
  });

  test('allows public HTTPS hostnames without resolving', () => {
    const url = parseS3EndpointUrl('https://s3.amazonaws.com');
    expect(url.hostname).toBe('s3.amazonaws.com');
    expect(() => assertS3EndpointHostSync('https://s3.amazonaws.com')).not.toThrow();
  });

  test('assertAddressAllowed respects env-equivalent policy', () => {
    expect(() => assertAddressAllowed('192.168.0.5')).toThrow();
    expect(() => assertAddressAllowed('192.168.0.5', { allowPrivate: true })).not.toThrow();
    expect(() => assertAddressAllowed('169.254.169.254', { allowPrivate: true })).toThrow(
      /metadata/i
    );
  });
});
