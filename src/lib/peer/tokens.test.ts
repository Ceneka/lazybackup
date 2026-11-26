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

  test('malformed invite payloads never surface a raw JSON parse error', () => {
    const broken = `lb1.${Buffer.from('{"v":1,"u":', 'utf8').toString('base64url')}`;
    expect(() => decodeInvitePayload(broken)).toThrow(/incomplete or corrupted/i);
    expect(() => decodeInvitePayload(broken)).not.toThrow(/JSON|Unexpected token/i);

    const wrongTypes = `lb1.${Buffer.from(JSON.stringify({ v: 1, u: '', c: 'X', s: 'y', q: 1 }), 'utf8').toString('base64url')}`;
    expect(() => decodeInvitePayload(wrongTypes)).toThrow(/incomplete or corrupted/i);

    const notObject = `lb1.${Buffer.from('[]', 'utf8').toString('base64url')}`;
    expect(() => decodeInvitePayload(notObject)).toThrow(/incomplete or corrupted/i);
  });
});
