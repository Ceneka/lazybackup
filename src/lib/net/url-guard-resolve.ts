import { lookup as dnsLookup } from 'node:dns/promises';
import {
  classifyIp,
  ipAllowed,
  normalizeHostname,
  peerUrlPolicy,
  validateHttpUrl,
  type UrlGuardPolicy,
  type UrlGuardResult,
} from './url-guard';

type LookupFn = (hostname: string) => Promise<string[]>;

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(normalizeHostname(hostname), { all: true, verbatim: true });
  return results.map((row) => row.address);
}

/**
 * Re-check after DNS so names that resolve to IMDS / loopback are rejected.
 * IP literals skip lookup. Server-only — do not import from client modules.
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

export async function validatePeerUrlResolved(
  raw: string,
  lookup?: LookupFn
): Promise<UrlGuardResult> {
  return validateHttpUrlResolved(raw, peerUrlPolicy(), lookup ?? defaultLookup);
}
