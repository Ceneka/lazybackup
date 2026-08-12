import { describe, expect, test } from 'bun:test';
import {
  decodeInvitePayload,
  encodeInvitePayload,
  generateInviteCode,
  hashInviteSecret,
  hashPeerToken,
  generatePeerToken,
} from './tokens';

describe('peer tokens', () => {
  test('peer token hash round-trip identity', () => {
    const { token, hash, prefix } = generatePeerToken();
    expect(token.startsWith('lbpeer_')).toBe(true);
    expect(hashPeerToken(token)).toBe(hash);
    expect(prefix.length).toBeGreaterThan(5);
  });

  test('invite payload encode/decode', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const encoded = encodeInvitePayload({
      v: 1,
      u: 'https://example.com',
      c: code,
      s: 'secret',
      q: 50 * 1024 * 1024 * 1024,
      n: 'Me',
    });
    expect(encoded.startsWith('lb1.')).toBe(true);
    const decoded = decodeInvitePayload(encoded);
    expect(decoded.c).toBe(code);
    expect(decoded.u).toBe('https://example.com');
    expect(hashInviteSecret('secret')).toHaveLength(64);
  });
});
