import { describe, expect, test } from 'bun:test';
import { TAILSCALE_SOCKET_PATHS, buildSuggestedBaseUrl } from './tailscale';

describe('tailscale helpers', () => {
  test('default socket paths include standard location', () => {
    expect(TAILSCALE_SOCKET_PATHS).toContain('/var/run/tailscale/tailscaled.sock');
  });
});

describe('buildSuggestedBaseUrl', () => {
  test('uses the real request port instead of PORT || 3000', () => {
    expect(buildSuggestedBaseUrl('100.70.83.23', null, { port: 3141 })).toBe(
      'http://100.70.83.23:3141'
    );
  });

  test('prefers an IPv4 address over MagicDNS', () => {
    expect(
      buildSuggestedBaseUrl('100.70.83.23', 'host.tailnet.ts.net', { port: '3141' })
    ).toBe('http://100.70.83.23:3141');
  });

  test('uses the DNS name when there is no IPv4', () => {
    expect(
      buildSuggestedBaseUrl(null, 'host.tailnet.ts.net.', { port: '3141' })
    ).toBe('http://host.tailnet.ts.net:3141');
  });

  test('respects https behind a trusted proxy and omits default ports', () => {
    expect(buildSuggestedBaseUrl('100.70.83.23', null, { protocol: 'https' })).toBe(
      'https://100.70.83.23'
    );
    expect(
      buildSuggestedBaseUrl('100.70.83.23', null, { protocol: 'https', port: 443 })
    ).toBe('https://100.70.83.23');
    expect(buildSuggestedBaseUrl('100.70.83.23', null, { port: 80 })).toBe(
      'http://100.70.83.23'
    );
  });

  test('returns null without an address and ignores invalid ports', () => {
    expect(buildSuggestedBaseUrl(null, null, { port: 3141 })).toBeNull();
    expect(buildSuggestedBaseUrl('100.70.83.23', null, { port: 'abc' })).toBe(
      'http://100.70.83.23'
    );
    expect(buildSuggestedBaseUrl('100.70.83.23', null, { port: 99999 })).toBe(
      'http://100.70.83.23'
    );
  });
});
