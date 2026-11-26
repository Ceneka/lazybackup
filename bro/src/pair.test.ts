import { describe, expect, test } from 'bun:test';
import { parsePairingResponse } from './pair';

describe('parsePairingResponse', () => {
  const valid = {
    peerId: 'peer-1',
    label: 'Friend',
    baseUrl: 'https://backup.example',
    inboundToken: `lbpeer_${'a'.repeat(32)}`,
    quotaBytes: 1024,
  };

  test('accepts and normalizes the allowlisted response shape', () => {
    expect(parsePairingResponse(valid, 'https://fallback.example')).toEqual(valid);
  });

  test('rejects missing tokens, bad quotas, and non-http URLs', () => {
    expect(() => parsePairingResponse({ ...valid, inboundToken: '' }, valid.baseUrl)).toThrow(
      /token/i
    );
    expect(() => parsePairingResponse({ ...valid, quotaBytes: -1 }, valid.baseUrl)).toThrow(
      /quota/i
    );
    expect(() => parsePairingResponse({ ...valid, baseUrl: 'file:///tmp/x' }, valid.baseUrl)).toThrow(
      /URL/i
    );
  });

  test('requires https for a public pairing URL', () => {
    expect(() =>
      parsePairingResponse({ ...valid, baseUrl: 'http://8.8.8.8' }, valid.baseUrl)
    ).toThrow(/https:\/\/.*LAN\/Tailscale/i);
    expect(
      parsePairingResponse({ ...valid, baseUrl: 'http://192.168.1.20:3000' }, valid.baseUrl)
        .baseUrl
    ).toBe('http://192.168.1.20:3000');
  });
});
