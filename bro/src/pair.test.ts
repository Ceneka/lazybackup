import { describe, expect, test } from 'bun:test';
import {
  PAIR_ADDRESS_MESSAGE,
  PAIR_EXPIRED_MESSAGE,
  PAIR_GENERIC_MESSAGE,
  PAIR_TOO_MANY_MESSAGE,
  PAIR_USED_MESSAGE,
  clearPairing,
  friendlyPairReplyError,
  friendlyPairTransportError,
  pairingName,
  parsePairingResponse,
} from './pair';
import type { BroConfig } from './config';

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
});

describe('friendly pair errors', () => {
  test('maps blocked and unreachable addresses to actionable copy', () => {
    for (const raw of [
      'Remote URL targets a blocked address',
      'Remote URL targets a blocked host',
      'Remote URL is invalid',
      'fetch failed',
      'connect ECONNREFUSED 192.168.0.10:3000',
      'getaddrinfo ENOTFOUND lazybackup.invalid',
      'Remote request to host timed out after 30000ms',
    ]) {
      const message = friendlyPairTransportError(new Error(raw));
      expect(message).toBe(PAIR_ADDRESS_MESSAGE);
      expect(message).toContain("Can't reach your friend's LazyBackup at that address.");
      expect(message).not.toMatch(/ECONNREFUSED|ENOTFOUND|fetch failed|blocked address/i);
    }
  });

  test('falls back to a generic but human message', () => {
    expect(friendlyPairTransportError(new Error('something odd'))).toBe(PAIR_GENERIC_MESSAGE);
  });

  test('maps expired and already-used invite replies', () => {
    expect(
      friendlyPairReplyError(400, 'Invite has expired. Ask your bro for a new one.')
    ).toBe(PAIR_EXPIRED_MESSAGE);
    expect(friendlyPairReplyError(400, 'Pairing failed')).toBe(PAIR_USED_MESSAGE);
    expect(friendlyPairReplyError(400, 'invite already used')).toBe(PAIR_USED_MESSAGE);
    expect(friendlyPairReplyError(429, '')).toBe(PAIR_TOO_MANY_MESSAGE);
  });

  test('never forwards parser text from the host', () => {
    const message = friendlyPairReplyError(400, 'Validation error');
    expect(message).toBe(PAIR_GENERIC_MESSAGE);
    expect(message).not.toMatch(/validation|json|zod/i);
    expect(friendlyPairReplyError(500, 'Unexpected token < in JSON')).toBe(PAIR_GENERIC_MESSAGE);
  });

  test('keeps a short, human host message', () => {
    expect(friendlyPairReplyError(400, 'That invite belongs to another computer.')).toBe(
      'That invite belongs to another computer.'
    );
  });
});

describe('pairingName', () => {
  test('never sends the product name as a person', () => {
    expect(pairingName(undefined, 'LazyBro')).toBe('Friend');
    expect(pairingName('', 'LazyBro')).toBe('Friend');
  });

  test('uses the explicit name first', () => {
    expect(pairingName(' Alex ', 'Saved')).toBe('Alex');
    expect(pairingName(undefined, 'Sam')).toBe('Sam');
  });
});

describe('clearPairing', () => {
  test('clears remote state and keeps local identity', () => {
    const cfg = {
      hostBaseUrl: 'https://host.example',
      outboundToken: 'lbpeer_secret',
      localPeerId: 'local',
      remotePeerId: 'remote',
      remoteLabel: 'Juan',
      quotaBytes: 42,
      label: 'Alex',
      shareDir: '/share',
    } as BroConfig;
    clearPairing(cfg);
    expect(cfg.hostBaseUrl).toBeNull();
    expect(cfg.outboundToken).toBeNull();
    expect(cfg.remotePeerId).toBeNull();
    expect(cfg.remoteLabel).toBeNull();
    expect(cfg.quotaBytes).toBe(0);
    expect(cfg.label).toBe('Alex');
    expect(cfg.shareDir).toBe('/share');
  });
});
