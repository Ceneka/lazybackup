import os from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { isSessionAuthorized } from '@/lib/auth';
import { buildAddressCandidates } from '@/lib/bro/addresses';
import { getRequestOrigin } from '@/lib/net/request-origin';
import { privatePeerUrlsAllowed } from '@/lib/net/url-guard';
import { getInstanceBaseUrl } from '@/lib/peer/pairing';
import { getTailscaleStatus, type TailscaleUrlHint } from '@/lib/peer/tailscale';

export const dynamic = 'force-dynamic';

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage Bro Space' },
      { status: 401 }
    );
  }
  return null;
}

/** Ignore container/VM bridges that a friend can never reach. */
const SKIP_INTERFACE = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|cali|kube|tailscale|zt|wg)/i;

function lanIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (SKIP_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (String(entry.family) !== 'IPv4') continue;
      if (!entry.address) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses];
}

/**
 * GET /api/peers/addresses — detected addresses for the invite wizard.
 *
 * Session-only (same check as /api/peers). Returns candidates with a
 * reachability classification; never dials the internet and never returns
 * secrets.
 */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const origin = getRequestOrigin({ headers: request.headers, url: request.url });
    const port =
      origin.port ??
      (origin.protocol === 'http' ? process.env.PORT?.trim() || null : null);
    const hint: TailscaleUrlHint = { protocol: origin.protocol, port };

    const [savedBaseUrl, tailscale] = await Promise.all([
      getInstanceBaseUrl(),
      getTailscaleStatus(hint),
    ]);

    const candidates = buildAddressCandidates({
      savedBaseUrl,
      tailscaleBaseUrl: tailscale.suggestedBaseUrl,
      requestOrigin: origin.origin,
      lanIpv4s: lanIpv4Addresses(),
      port,
      protocol: origin.protocol,
    });

    return NextResponse.json({
      instanceBaseUrl: savedBaseUrl,
      allowPrivatePeerUrls: privatePeerUrlsAllowed(),
      candidates,
      port,
      tailscale: {
        available: tailscale.available,
        cliAvailable: tailscale.cliAvailable,
        suggestedBaseUrl: tailscale.suggestedBaseUrl,
      },
    });
  } catch (error) {
    console.error('Address detection failed:', error);
    return NextResponse.json(
      { error: 'Failed to detect addresses' },
      { status: 500 }
    );
  }
}
