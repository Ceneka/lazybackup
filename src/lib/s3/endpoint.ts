import { lookup } from 'dns/promises';
import net from 'net';

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

export type S3EndpointPolicy = {
  allowPrivate?: boolean | null;
};
type S3Lookup = typeof lookup;

export function allowPrivateS3Endpoints(profile?: S3EndpointPolicy): boolean {
  if (profile?.allowPrivate === true) return true;
  return process.env.ALLOW_PRIVATE_S3_ENDPOINTS === 'true';
}

export function parseS3EndpointUrl(endpoint: string): URL {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error('S3 endpoint is required');
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid S3 endpoint: ${endpoint}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported S3 endpoint protocol: ${url.protocol}`);
  }
  return url;
}

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

export type AddressClass = 'loopback' | 'link-local' | 'private' | 'metadata' | 'public';

export function classifyIpAddress(ip: string): AddressClass {
  let value = ip.trim().toLowerCase();
  if (value.startsWith('::ffff:')) {
    value = value.slice('::ffff:'.length);
    if (!net.isIPv4(value)) {
      const mapped = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
      if (mapped) {
        const hi = parseInt(mapped[1]!, 16);
        const lo = parseInt(mapped[2]!, 16);
        value = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      }
    }
  }

  if (value === '::1') return 'loopback';
  if (value === 'fd00:ec2::254') return 'metadata';
  if (value.startsWith('fe80:')) return 'link-local';
  if (value.startsWith('fc') || value.startsWith('fd')) return 'private';

  const octets = ipv4Octets(value);
  if (!octets) {
    if (net.isIP(value) === 6) return 'public';
    return 'public';
  }
  const [a, b] = octets;
  if (a === 127) return 'loopback';
  if (a === 0) return 'loopback';
  if (a === 169 && b === 254) {
    if (octets[2] === 169 && octets[3] === 254) return 'metadata';
    return 'link-local';
  }
  if (value === '100.100.100.200') return 'metadata';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  return 'public';
}

export function classifyHostname(hostname: string): AddressClass | 'hostname' {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) {
    throw new Error('S3 endpoint hostname is required');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';
  if (METADATA_HOSTS.has(host) || host.endsWith('.metadata.google.internal')) return 'metadata';
  if (net.isIP(host)) return classifyIpAddress(host);
  return 'hostname';
}

export function assertAddressAllowed(
  address: string,
  policy?: S3EndpointPolicy
): void {
  const kind = net.isIP(address) ? classifyIpAddress(address) : classifyHostname(address);
  const allowPrivate = allowPrivateS3Endpoints(policy);
  if (kind === 'hostname') return;
  if (kind === 'public') return;
  if (kind === 'metadata') {
    throw new Error(
      `Refusing S3 endpoint address ${address} (cloud metadata). This looks like SSRF.`
    );
  }
  if (allowPrivate) return;
  if (kind === 'link-local') {
    throw new Error(
      `Refusing S3 endpoint address ${address} (link-local). Set ALLOW_PRIVATE_S3_ENDPOINTS=true for LAN MinIO.`
    );
  }
  if (kind === 'loopback' || kind === 'private') {
    throw new Error(
      `Refusing private/loopback S3 endpoint ${address}. Set ALLOW_PRIVATE_S3_ENDPOINTS=true for LAN MinIO.`
    );
  }
}

/** Sync checks: literal IPs, localhost, metadata hostnames. Does not DNS-resolve. */
export function assertS3EndpointHostSync(
  endpoint: string,
  policy?: S3EndpointPolicy
): URL {
  const url = parseS3EndpointUrl(endpoint);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const kind = classifyHostname(host);
  if (kind !== 'hostname') {
    assertAddressAllowed(host, policy);
  }
  return url;
}

/** Resolve hostnames and reject private/metadata answers (DNS rebinding-aware at lookup time). */
export async function assertS3EndpointAllowed(
  endpoint: string,
  policy?: S3EndpointPolicy,
  lookupFn: S3Lookup = lookup
): Promise<string[]> {
  const url = assertS3EndpointHostSync(endpoint, policy);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) || classifyHostname(host) !== 'hostname') {
    return [host];
  }
  const results = await lookupFn(host, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error(`S3 endpoint hostname did not resolve: ${host}`);
  }
  for (const result of results) {
    assertAddressAllowed(result.address, policy);
  }
  return [...new Set(results.map((result) => result.address))];
}
