import { describe, expect, test } from 'bun:test';
import { TAILSCALE_SOCKET_PATHS } from './tailscale';

describe('tailscale helpers', () => {
  test('default socket paths include standard location', () => {
    expect(TAILSCALE_SOCKET_PATHS).toContain('/var/run/tailscale/tailscaled.sock');
  });
});
