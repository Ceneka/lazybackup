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

const LOOPBACK_V4: Cidr4 = ['127.0.0.0', 8];
const RFC1918: Cidr4[] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];
const LINK_LOCAL_V4: Cidr4 = ['169.254.0.0', 16];
const CGNAT_V4: Cidr4 = ['100.64.0.0', 10];
const THIS_NETWORK_V4: Cidr4 = ['0.0.0.0', 8];
const MULTICAST_V4: Cidr4 = ['224.0.0.0', 4];
const BENCHMARK_V4: Cidr4 = ['198.18.0.0', 15];
const IETF_V4: Cidr4 = ['192.0.0.0', 24];
const TESTNET_V4: Cidr4[] = [
  ['192.0.2.0', 24],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
];

const LOOPBACK_V6: Cidr6 = ['::1', 128];
const LINK_LOCAL_V6: Cidr6 = ['fe80::', 10];
const ULA_V6: Cidr6 = ['fc00::', 7];
const TAILSCALE_V6: Cidr6 = ['fd7a:115c:a1e0::', 48];
const MULTICAST_V6: Cidr6 = ['ff00::', 8];
const UNSPECIFIED_V6: Cidr6 = ['::', 128];

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

type Cidr4 = readonly [network: string, prefix: number];
type Cidr6 = readonly [network: string, prefix: number];

function isIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

function ipv4ToInt(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  const [a, b, c, d] = ip.split('.').map(Number);
  return ((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0;
}

function ipv4InCidr(ip: string, network: string, prefix: number): boolean {
  const addr = ipv4ToInt(ip);
  const net = ipv4ToInt(network);
  if (addr === null || net === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addr & mask) === (net & mask);
}

function parseIPv6(ip: string): bigint | null {
  let value = ip.trim().toLowerCase();
  if (!value.includes(':')) return null;

  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);

  const lastColon = value.lastIndexOf(':');
  const tail = lastColon >= 0 ? value.slice(lastColon + 1) : value;
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const v4 = ipv4ToInt(tail)!;
    value = `${value.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  let groups: number[];
  if (halves.length === 1) {
    const parsed = parseGroups(halves[0]!);
    if (!parsed || parsed.length !== 8) return null;
    groups = parsed;
  } else {
    const left = parseGroups(halves[0]!);
    const right = parseGroups(halves[1]!);
    if (!left || !right) return null;
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill(0), ...right];
  }

  let n = 0n;
  for (const group of groups) {
    n = (n << 16n) | BigInt(group);
  }
  return n;
}

function ipv6InCidr(ip: string, network: string, prefix: number): boolean {
  const addr = parseIPv6(ip);
  const net = parseIPv6(network);
  if (addr === null || net === null) return false;
  const shift = 128n - BigInt(prefix);
  return addr >> shift === net >> shift;
}

function inV4(ip: string, cidr: Cidr4): boolean {
  return ipv4InCidr(ip, cidr[0], cidr[1]);
}

function inAnyV4(ip: string, cidrs: readonly Cidr4[]): boolean {
  return cidrs.some((cidr) => inV4(ip, cidr));
}

function inV6(ip: string, cidr: Cidr6): boolean {
  return ipv6InCidr(ip, cidr[0], cidr[1]);
}

/** 4, 6, or 0 — isomorphic stand-in for `net.isIP`. */
function ipVersion(ip: string): 0 | 4 | 6 {
  if (isIPv4(ip)) return 4;
  if (parseIPv6(ip) !== null) return 6;
  return 0;
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
  if (isIPv4(rest)) return rest;
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

  const version = ipVersion(ip);
  if (version === 4) {
    if (inV4(ip, LOOPBACK_V4)) return 'loopback';
    if (inV4(ip, LINK_LOCAL_V4)) return 'linkLocal';
    if (inV4(ip, THIS_NETWORK_V4)) return 'unspecified';
    if (inV4(ip, MULTICAST_V4)) return 'multicast';
    if (ip === '255.255.255.255') return 'reserved';
    if (inV4(ip, BENCHMARK_V4) || inV4(ip, IETF_V4) || inAnyV4(ip, TESTNET_V4)) {
      return 'reserved';
    }
    if (inAnyV4(ip, RFC1918)) return 'private';
    if (inV4(ip, CGNAT_V4)) return 'cgnat';
    return 'public';
  }

  if (version === 6) {
    if (inV6(ip, UNSPECIFIED_V6)) return 'unspecified';
    if (inV6(ip, LOOPBACK_V6)) return 'loopback';
    if (inV6(ip, LINK_LOCAL_V6)) return 'linkLocal';
    if (inV6(ip, MULTICAST_V6)) return 'multicast';
    if (inV6(ip, TAILSCALE_V6)) return 'tailscale';
    if (inV6(ip, ULA_V6)) return 'ula';
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

export function ipAllowed(ipClass: IpClass, policy: UrlGuardPolicy): boolean {
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

export function validatePeerUrl(raw: string | null | undefined): UrlGuardResult {
  return validateHttpUrl(raw, peerUrlPolicy());
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
