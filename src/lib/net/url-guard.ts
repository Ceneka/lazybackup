import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type UrlGuardResult = { ok: true; url: string } | { ok: false; error: string };

export type UrlGuardPolicy = {
  /** RFC1918, loopback, ULA, *.local — never link-local / IMDS / metadata. */
  allowPrivate: boolean;
  /** Tailscale CGNAT 100.64/10 and fd7a:115c:a1e0::/48. */
  allowCgnat: boolean;
  /** true = http allowed when the host passes IP policy; 'private-only' = http only for private/loopback/cgnat. */
  allowHttp: boolean | 'private-only';
  /** Error prefix, e.g. "Webhook URL" / "Peer URL". */
  label: string;
};

export type LookupFn = (hostname: string) => Promise<string[]>;

const LOOPBACK_V4 = blockList([['127.0.0.0', 8, 'ipv4']]);
const RFC1918 = blockList([
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
]);
const LINK_LOCAL_V4 = blockList([['169.254.0.0', 16, 'ipv4']]);
const CGNAT_V4 = blockList([['100.64.0.0', 10, 'ipv4']]);
const THIS_NETWORK_V4 = blockList([['0.0.0.0', 8, 'ipv4']]);
const MULTICAST_V4 = blockList([['224.0.0.0', 4, 'ipv4']]);
const BENCHMARK_V4 = blockList([['198.18.0.0', 15, 'ipv4']]);
const IETF_V4 = blockList([['192.0.0.0', 24, 'ipv4']]);
const TESTNET_V4 = blockList([
  ['192.0.2.0', 24, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
]);

const LOOPBACK_V6 = blockList([['::1', 128, 'ipv6']]);
const LINK_LOCAL_V6 = blockList([['fe80::', 10, 'ipv6']]);
const ULA_V6 = blockList([['fc00::', 7, 'ipv6']]);
const TAILSCALE_V6 = blockList([['fd7a:115c:a1e0::', 48, 'ipv6']]);
const MULTICAST_V6 = blockList([['ff00::', 8, 'ipv6']]);
const UNSPECIFIED_V6 = blockList([['::', 128, 'ipv6']]);

const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'localhost6',
  'ip6-localhost',
  'ip6-loopback',
]);

const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.internal',
  'instance-data',
]);

export const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

function blockList(entries: Array<[string, number, 'ipv4' | 'ipv6']>): BlockList {
  const list = new BlockList();
  for (const [net, prefix, type] of entries) {
    list.addSubnet(net, prefix, type);
  }
  return list;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
}

/** Pairing / mailbox dials. Default denies RFC1918 and loopback; Tailscale CGNAT stays allowed. */
export function privatePeerUrlsAllowed(): boolean {
  return envFlag('ALLOW_PRIVATE_PEER_URLS', false);
}

/**
 * Operator-configured webhooks/pings. Default allows RFC1918 + loopback HTTP (LAN ntfy/Kuma).
 * IMDS / link-local are always blocked. Set `false` to require public HTTPS only.
 */
export function lanWebhooksAllowed(): boolean {
  return envFlag('ALLOW_LAN_WEBHOOKS', true);
}

export function peerUrlPolicy(): UrlGuardPolicy {
  return {
    allowPrivate: privatePeerUrlsAllowed(),
    allowCgnat: true,
    allowHttp: true,
    label: 'Peer URL',
  };
}

export function webhookUrlPolicy(options?: { allowLan?: boolean }): UrlGuardPolicy {
  const allowLan = options?.allowLan ?? lanWebhooksAllowed();
  return {
    allowPrivate: allowLan,
    allowCgnat: allowLan,
    allowHttp: 'private-only',
    label: 'Webhook URL',
  };
}

export function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);
  return host;
}

/** Convert IPv4-mapped IPv6 (::ffff:127.0.0.1 / ::ffff:7f00:1) to dotted IPv4. */
export function mappedIpv4(ipv6: string): string | null {
  const host = normalizeHostname(ipv6);
  if (!host.startsWith('::ffff:')) return null;
  const rest = host.slice('::ffff:'.length);
  if (isIP(rest) === 4) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export type IpClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'ula'
  | 'tailscale'
  | 'linkLocal'
  | 'unspecified'
  | 'multicast'
  | 'reserved';

export function classifyIp(ip: string): IpClass | null {
  const mapped = mappedIpv4(ip);
  if (mapped) return classifyIp(mapped);

  const version = isIP(ip);
  if (version === 4) {
    if (LOOPBACK_V4.check(ip, 'ipv4')) return 'loopback';
    if (LINK_LOCAL_V4.check(ip, 'ipv4')) return 'linkLocal';
    if (THIS_NETWORK_V4.check(ip, 'ipv4')) return 'unspecified';
    if (MULTICAST_V4.check(ip, 'ipv4')) return 'multicast';
    if (ip === '255.255.255.255') return 'reserved';
    if (BENCHMARK_V4.check(ip, 'ipv4') || IETF_V4.check(ip, 'ipv4') || TESTNET_V4.check(ip, 'ipv4')) {
      return 'reserved';
    }
    if (RFC1918.check(ip, 'ipv4')) return 'private';
    if (CGNAT_V4.check(ip, 'ipv4')) return 'cgnat';
    return 'public';
  }

  if (version === 6) {
    if (UNSPECIFIED_V6.check(ip, 'ipv6')) return 'unspecified';
    if (LOOPBACK_V6.check(ip, 'ipv6')) return 'loopback';
    if (LINK_LOCAL_V6.check(ip, 'ipv6')) return 'linkLocal';
    if (MULTICAST_V6.check(ip, 'ipv6')) return 'multicast';
    if (TAILSCALE_V6.check(ip, 'ipv6')) return 'tailscale';
    if (ULA_V6.check(ip, 'ipv6')) return 'ula';
    return 'public';
  }

  return null;
}

function isLoopbackHostname(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.localhost.localdomain')) return true;
  return false;
}

function isMetadataHostname(host: string): boolean {
  if (METADATA_HOSTS.has(host)) return true;
  if (host.endsWith('.metadata.google.internal')) return true;
  return false;
}

function ipAllowed(ipClass: IpClass, policy: UrlGuardPolicy): boolean {
  switch (ipClass) {
    case 'public':
      return true;
    case 'cgnat':
    case 'tailscale':
      return policy.allowCgnat || policy.allowPrivate;
    case 'private':
    case 'ula':
    case 'loopback':
      return policy.allowPrivate;
    case 'linkLocal':
    case 'unspecified':
    case 'multicast':
    case 'reserved':
      return false;
    default:
      return false;
  }
}

function hostKind(
  hostname: string
): { kind: 'ip'; ipClass: IpClass } | { kind: 'name'; nameClass: 'loopback' | 'metadata' | 'mdns' | 'public' } {
  const host = normalizeHostname(hostname);
  const ipClass = classifyIp(host);
  if (ipClass) return { kind: 'ip', ipClass };
  if (isLoopbackHostname(host)) return { kind: 'name', nameClass: 'loopback' };
  if (isMetadataHostname(host)) return { kind: 'name', nameClass: 'metadata' };
  if (host.endsWith('.local')) return { kind: 'name', nameClass: 'mdns' };
  return { kind: 'name', nameClass: 'public' };
}

function hostAllowed(hostname: string, policy: UrlGuardPolicy): boolean {
  const kind = hostKind(hostname);
  if (kind.kind === 'ip') return ipAllowed(kind.ipClass, policy);
  switch (kind.nameClass) {
    case 'public':
      return true;
    case 'mdns':
    case 'loopback':
      return policy.allowPrivate;
    case 'metadata':
      return false;
    default:
      return false;
  }
}

function hostIsPrivateish(hostname: string): boolean {
  const kind = hostKind(hostname);
  if (kind.kind === 'ip') {
    return kind.ipClass !== 'public';
  }
  return kind.nameClass !== 'public';
}

export function validateHttpUrl(
  raw: string | null | undefined,
  policy: UrlGuardPolicy
): UrlGuardResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: `${policy.label} is empty` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `Invalid ${policy.label.toLowerCase()}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `${policy.label} must be http(s)` };
  }

  if (!parsed.hostname) {
    return { ok: false, error: `Invalid ${policy.label.toLowerCase()}` };
  }

  if (!hostAllowed(parsed.hostname, policy)) {
    return { ok: false, error: `${policy.label} targets a disallowed address` };
  }

  if (parsed.protocol === 'http:') {
    if (policy.allowHttp === false) {
      return { ok: false, error: `${policy.label} must use HTTPS` };
    }
    if (policy.allowHttp === 'private-only' && !hostIsPrivateish(parsed.hostname)) {
      return {
        ok: false,
        error: `${policy.label} must use HTTPS (http is only allowed for localhost/LAN)`,
      };
    }
  }

  return { ok: true, url: parsed.toString() };
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(normalizeHostname(hostname), { all: true, verbatim: true });
  return results.map((row) => row.address);
}

/**
 * Re-check after DNS so names that resolve to IMDS / loopback are rejected.
 * IP literals skip lookup.
 */
export async function validateHttpUrlResolved(
  raw: string,
  policy: UrlGuardPolicy,
  lookup: LookupFn = defaultLookup
): Promise<UrlGuardResult> {
  const first = validateHttpUrl(raw, policy);
  if (!first.ok) return first;

  const parsed = new URL(first.url);
  const host = normalizeHostname(parsed.hostname);
  if (classifyIp(host)) {
    return first;
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, error: `${policy.label} could not be resolved` };
  }

  if (!addresses.length) {
    return { ok: false, error: `${policy.label} could not be resolved` };
  }

  for (const address of addresses) {
    const ipClass = classifyIp(address);
    if (!ipClass || !ipAllowed(ipClass, policy)) {
      return { ok: false, error: `${policy.label} targets a disallowed address` };
    }
  }

  return first;
}

export function validatePeerUrl(raw: string | null | undefined): UrlGuardResult {
  return validateHttpUrl(raw, peerUrlPolicy());
}

export async function validatePeerUrlResolved(
  raw: string,
  lookup?: LookupFn
): Promise<UrlGuardResult> {
  return validateHttpUrlResolved(raw, peerUrlPolicy(), lookup ?? defaultLookup);
}

export function assertPeerBaseUrl(raw: string): void {
  const result = validatePeerUrl(raw);
  if (!result.ok) throw new Error(result.error);
}

/** Resolve a redirect Location against the request URL and re-apply the same policy. */
export function validateRedirectTarget(
  requestUrl: string,
  location: string | null | undefined,
  policy: UrlGuardPolicy
): UrlGuardResult {
  const trimmed = (location ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: `${policy.label} redirect was blocked` };
  }

  let next: URL;
  try {
    next = new URL(trimmed, requestUrl);
  } catch {
    return { ok: false, error: `${policy.label} redirect was blocked` };
  }

  const result = validateHttpUrl(next.toString(), policy);
  if (!result.ok) {
    return { ok: false, error: `${policy.label} redirect was blocked` };
  }
  return result;
}

export function isForbiddenRequestHeader(name: string): boolean {
  return FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase());
}
