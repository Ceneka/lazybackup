import { describe, expect, test } from 'bun:test';
import { resolveSafeRemoteUrl } from './remote';

describe('LazyBro remote URL guard', () => {
  test('preserves intended LAN and Tailscale endpoints', async () => {
    expect((await resolveSafeRemoteUrl('http://192.168.1.20:3000')).addresses).toEqual([
      '192.168.1.20',
    ]);
    expect((await resolveSafeRemoteUrl('http://100.64.1.2:3000')).addresses).toEqual([
      '100.64.1.2',
    ]);
  });

  test('blocks loopback and link-local metadata addresses', async () => {
    await expect(resolveSafeRemoteUrl('http://127.0.0.1:3000')).rejects.toThrow(/blocked/);
    await expect(resolveSafeRemoteUrl('http://169.254.169.254/')).rejects.toThrow(/blocked/);
    await expect(resolveSafeRemoteUrl('http://100.100.100.200/')).rejects.toThrow(/blocked/);
    await expect(resolveSafeRemoteUrl('http://[fd00:ec2::254]/')).rejects.toThrow(/blocked/);
    await expect(resolveSafeRemoteUrl('http://[::1]/')).rejects.toThrow(/blocked/);
    await expect(resolveSafeRemoteUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(/blocked/);
  });
});
