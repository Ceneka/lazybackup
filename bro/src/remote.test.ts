import { describe, expect, test } from 'bun:test';
import http from 'node:http';
import os from 'node:os';
import { assertPeerHostUrl, resolveSafeRemoteUrl, safeRemoteFetch } from './remote';

describe('LazyBro peer URL scheme policy', () => {
  test('requires https for public addresses', async () => {
    expect(() => assertPeerHostUrl('http://8.8.8.8:3000')).toThrow(
      /https:\/\/.*LAN\/Tailscale/i
    );
    // DNS names are decided after resolution (MagicDNS *.ts.net, nas.lan, …).
    expect(() => assertPeerHostUrl('http://nas.tail1234.ts.net:3000')).not.toThrow();
    await expect(resolveSafeRemoteUrl('http://8.8.8.8:3000')).rejects.toThrow(/https:/i);
  });

  test('keeps http for LAN, loopback, and Tailscale addresses', () => {
    expect(() => assertPeerHostUrl('http://192.168.1.20:3000')).not.toThrow();
    expect(() => assertPeerHostUrl('http://127.0.0.1:3000')).not.toThrow();
    expect(() => assertPeerHostUrl('http://100.64.1.2:3000')).not.toThrow();
    expect(() => assertPeerHostUrl('http://[fd7a:115c:a1e0::1]:3000')).not.toThrow();
    expect(() => assertPeerHostUrl('https://backup.example.com')).not.toThrow();
  });
});

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

  test('times out a host that accepts the connection and never responds', async () => {
    const lanIp = Object.values(os.networkInterfaces())
      .flat()
      .find((row) => row && row.family === 'IPv4' && !row.internal)?.address;
    if (!lanIp) return; // no non-loopback interface (rare CI container)

    const server = http.createServer(() => {
      /* intentionally never respond */
    });
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    try {
      await expect(
        safeRemoteFetch(`http://${lanIp}:${address.port}/`, {}, { timeoutMs: 150 })
      ).rejects.toThrow(/timed out/i);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
