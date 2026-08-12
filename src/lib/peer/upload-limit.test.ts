import { describe, expect, test } from 'bun:test';
import {
  assertDeclaredUploadSize,
  parseContentLengthHeader,
  PeerUploadLimitError,
} from './upload-limit';

describe('parseContentLengthHeader', () => {
  test('parses a non-negative integer', () => {
    expect(parseContentLengthHeader('0')).toBe(0);
    expect(parseContentLengthHeader('4096')).toBe(4096);
  });

  test('rejects missing or invalid values', () => {
    expect(parseContentLengthHeader(null)).toBeNull();
    expect(parseContentLengthHeader('')).toBeNull();
    expect(parseContentLengthHeader('1.5')).toBeNull();
    expect(parseContentLengthHeader('-1')).toBeNull();
    expect(parseContentLengthHeader('abc')).toBeNull();
  });
});

describe('assertDeclaredUploadSize', () => {
  test('requires Content-Length', () => {
    expect(() =>
      assertDeclaredUploadSize({ contentLengthHeader: null, quotaBytes: 1000 })
    ).toThrow(PeerUploadLimitError);
    try {
      assertDeclaredUploadSize({ contentLengthHeader: null, quotaBytes: 1000 });
    } catch (error) {
      expect(error).toBeInstanceOf(PeerUploadLimitError);
      expect((error as PeerUploadLimitError).status).toBe(411);
    }
  });

  test('rejects uploads over the hard cap', () => {
    expect(() =>
      assertDeclaredUploadSize({
        contentLengthHeader: '500',
        quotaBytes: 10_000,
        hardCapBytes: 100,
      })
    ).toThrow(/hard cap/i);
  });

  test('rejects uploads over the peer quota cap', () => {
    expect(() =>
      assertDeclaredUploadSize({
        contentLengthHeader: '200',
        quotaBytes: 100,
      })
    ).toThrow(/quota cap/i);
  });

  test('returns declared size when within quota and cap', () => {
    expect(
      assertDeclaredUploadSize({
        contentLengthHeader: '50',
        quotaBytes: 100,
      })
    ).toBe(50);
  });
});
