import { describe, expect, test } from 'bun:test';
import {
  INVITE_INCOMPLETE_MESSAGE,
  INVITE_NOT_RIGHT_MESSAGE,
  decodeInvitePayload,
  extractInviteCode,
  type InvitePayload,
} from './tokens';

function encode(value: unknown): string {
  return 'lb1.' + Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const valid: InvitePayload = {
  v: 1,
  u: 'http://192.168.0.10:3000',
  c: 'invite-code',
  s: 'invite-secret',
  q: 25 * 1024 ** 3,
  n: 'Juan',
};

describe('extractInviteCode', () => {
  test('finds the code inside the whole invite message', () => {
    const message = `Hi Alex — I set up a shared backup folder.\n\nPaste this invite:\n${encode(
      valid
    )}\n\nLeave LazyBro running.`;
    const code = extractInviteCode(message);
    expect(code).toBe(encode(valid));
  });

  test('returns null when there is no lb1 code', () => {
    expect(extractInviteCode('hello there')).toBeNull();
    expect(extractInviteCode('lb1.ab')).toBeNull();
  });
});

describe('decodeInvitePayload', () => {
  test('decodes a valid payload and keeps the host name', () => {
    expect(decodeInvitePayload(encode(valid))).toEqual(valid);
    expect(decodeInvitePayload(`Message text\n${encode(valid)}\nmore text`)).toEqual(valid);
  });

  test('never leaks base64/JSON parser errors', () => {
    let message = '';
    try {
      decodeInvitePayload('lb1.not-a-real-invite');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(INVITE_NOT_RIGHT_MESSAGE);
    expect(message).not.toMatch(/json|unexpected|token|base64/i);
  });

  test('asks for the whole message when the code is not an invite', () => {
    expect(() => decodeInvitePayload('https://example.com')).toThrow(INVITE_NOT_RIGHT_MESSAGE);
    expect(() => decodeInvitePayload('lb1.!!!')).toThrow(INVITE_NOT_RIGHT_MESSAGE);
  });

  test('reports incomplete payloads separately', () => {
    expect(() => decodeInvitePayload(encode({ v: 1, u: 'http://host', c: 'x', s: 'y' }))).toThrow(
      INVITE_INCOMPLETE_MESSAGE
    );
    expect(() =>
      decodeInvitePayload(encode({ ...valid, q: 0 }))
    ).toThrow(INVITE_INCOMPLETE_MESSAGE);
    expect(() =>
      decodeInvitePayload(encode({ ...valid, u: 'ftp://example.com' }))
    ).toThrow(INVITE_INCOMPLETE_MESSAGE);
  });

  test('tolerates a missing host name', () => {
    const { n: _n, ...withoutName } = valid;
    expect(decodeInvitePayload(encode(withoutName)).n).toBe('');
  });
});
