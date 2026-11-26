import { describe, expect, test } from 'bun:test';
import { validateHttpUrlResolved } from './url-guard-resolve';
import {
  classifyIp,
  mappedIpv4,
  peerUrlPolicy,
  validateHttpUrl,
  validatePeerUrl,
  validateRedirectTarget,
  webhookUrlPolicy,
} from './url-guard';

describe('classifyIp', () => {
  test('classifies loopback, RFC1918, IMDS, and public', () => {
    expect(classifyIp('127.0.0.1')).toBe('loopback');
    expect(classifyIp('10.0.0.1')).toBe('private');
    expect(classifyIp('192.168.1.10')).toBe('private');
    expect(classifyIp('172.16.0.1')).toBe('private');
    expect(classifyIp('169.254.169.254')).toBe('linkLocal');
    expect(classifyIp('100.100.100.200')).toBe('linkLocal');
    expect(classifyIp('8.8.8.8')).toBe('public');
    expect(classifyIp('100.64.1.2')).toBe('cgnat');
    expect(classifyIp('::1')).toBe('loopback');
    expect(classifyIp('fd00::1')).toBe('ula');
    expect(classifyIp('fe80::1')).toBe('linkLocal');
    expect(classifyIp('fd00:ec2::254')).toBe('linkLocal');
  });

  test('maps IPv4-mapped IPv6 to the v4 class', () => {
    expect(mappedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(mappedIpv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(classifyIp('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyIp('::ffff:a9fe:a9fe')).toBe('linkLocal');
  });
});

describe('validatePeerUrl', () => {
  test('allows https://example.com', () => {
    const result = validatePeerUrl('https://example.com');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain('https://example.com');
  });

  test('blocks loopback, IMDS, file, and RFC1918 by default', () => {
    expect(validatePeerUrl('http://127.0.0.1').ok).toBe(false);
    expect(validatePeerUrl('http://localhost').ok).toBe(false);
    expect(validatePeerUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validatePeerUrl('https://169.254.169.254/').ok).toBe(false);
    expect(validatePeerUrl('http://10.0.0.5:3000').ok).toBe(false);
    expect(validatePeerUrl('http://192.168.1.5').ok).toBe(false);
    expect(validatePeerUrl('http://[fd00::1]/').ok).toBe(false);
    expect(validatePeerUrl('http://[::1]/').ok).toBe(false);
    expect(validatePeerUrl('file:///etc/passwd').ok).toBe(false);
  });

  test('allows Tailscale CGNAT without the private flag', () => {
    expect(validatePeerUrl('http://100.64.1.20:3000').ok).toBe(true);
    expect(validatePeerUrl('http://[fd7a:115c:a1e0::1]:3000').ok).toBe(true);
  });

  test('requires https for public addresses', async () => {
    const result = validatePeerUrl('http://8.8.8.8:3000');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('https://');
      expect(result.error).toContain('LAN/Tailscale');
    }
    expect(validatePeerUrl('https://backup.example.com:3000').ok).toBe(true);
    // Names are decided after DNS: a public answer means no http.
    const publicName = await validateHttpUrlResolved(
      'http://backup.example.com:3000',
      peerUrlPolicy(),
      async () => ['93.184.216.34']
    );
    expect(publicName.ok).toBe(false);
    if (!publicName.ok) expect(publicName.error).toContain('https://');
  });

  test('allows http to names that resolve to Tailscale / LAN (MagicDNS, nas.lan)', async () => {
    const magic = await validateHttpUrlResolved(
      'http://nas.tail1234.ts.net:3000',
      peerUrlPolicy(),
      async () => ['100.101.102.103']
    );
    expect(magic.ok).toBe(true);
    const lan = await validateHttpUrlResolved(
      'http://nas.lan:3000',
      { ...peerUrlPolicy(), allowPrivate: true },
      async () => ['192.168.1.20']
    );
    expect(lan.ok).toBe(true);
  });

  test('still allows http to LAN and Tailscale addresses', () => {
    const lanPolicy = { ...peerUrlPolicy(), allowPrivate: true };
    expect(validateHttpUrl('http://192.168.1.5:3000', lanPolicy).ok).toBe(true);
    expect(validateHttpUrl('http://127.0.0.1:3000', lanPolicy).ok).toBe(true);
    expect(validateHttpUrl('http://100.64.1.20:3000', peerUrlPolicy()).ok).toBe(true);
  });

  test('allows RFC1918 when allowPrivate is on', () => {
    const policy = { ...peerUrlPolicy(), allowPrivate: true };
    expect(validateHttpUrl('http://192.168.1.5:3000', policy).ok).toBe(true);
    expect(validateHttpUrl('http://127.0.0.1:3000', policy).ok).toBe(true);
    expect(validateHttpUrl('http://169.254.169.254/', policy).ok).toBe(false);
  });
});

describe('webhook URL policy', () => {
  test('allows public https and LAN http when LAN is enabled', () => {
    const policy = webhookUrlPolicy({ allowLan: true });
    expect(validateHttpUrl('https://example.com/hook', policy).ok).toBe(true);
    expect(validateHttpUrl('http://127.0.0.1/hook', policy).ok).toBe(true);
    expect(validateHttpUrl('http://192.168.1.10/hook', policy).ok).toBe(true);
    expect(validateHttpUrl('http://example.com/hook', policy).ok).toBe(false);
    expect(validateHttpUrl('https://169.254.169.254/', policy).ok).toBe(false);
    expect(validateHttpUrl('http://169.254.169.254/', policy).ok).toBe(false);
  });

  test('LAN off requires public HTTPS', () => {
    const policy = webhookUrlPolicy({ allowLan: false });
    expect(validateHttpUrl('https://hooks.example.com/x', policy).ok).toBe(true);
    expect(validateHttpUrl('http://127.0.0.1/hook', policy).ok).toBe(false);
    expect(validateHttpUrl('http://192.168.1.10/hook', policy).ok).toBe(false);
  });
});

describe('redirect policy', () => {
  test('rejects Location pointing at IMDS without following', () => {
    const policy = webhookUrlPolicy({ allowLan: true });
    const result = validateRedirectTarget(
      'https://hooks.example.com/x',
      'http://169.254.169.254/latest/meta-data',
      policy
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain('redirect');
  });

  test('rejects loopback redirect under peer policy', () => {
    const result = validateRedirectTarget(
      'https://example.com/api/peers/pair',
      'http://127.0.0.1/secret',
      peerUrlPolicy()
    );
    expect(result.ok).toBe(false);
  });

  test('allows same-policy https Location', () => {
    const result = validateRedirectTarget(
      'https://hooks.example.com/x',
      'https://hooks.example.com/y',
      webhookUrlPolicy({ allowLan: false })
    );
    expect(result.ok).toBe(true);
  });
});

describe('DNS rebinding', () => {
  test('blocks names that resolve to 169.254.169.254', async () => {
    const result = await validateHttpUrlResolved(
      'https://evil.example',
      peerUrlPolicy(),
      async () => ['169.254.169.254']
    );
    expect(result.ok).toBe(false);
  });

  test('allows names that resolve to a public IP', async () => {
    const result = await validateHttpUrlResolved(
      'https://example.com',
      peerUrlPolicy(),
      async () => ['93.184.216.34']
    );
    expect(result.ok).toBe(true);
  });
});
