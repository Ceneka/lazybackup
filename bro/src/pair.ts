import { nanoid } from 'nanoid';
import type { BroConfig } from './config';
import { saveConfig } from './config';
import { decodeInvitePayload, generatePeerToken } from './tokens';
import { safeRemoteFetch } from './remote';

export type PairingResponse = {
  peerId: string;
  label: string;
  baseUrl: string;
  inboundToken: string;
  quotaBytes: number;
};

export function parsePairingResponse(value: unknown, fallbackBaseUrl: string): PairingResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pairing response was invalid');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.peerId !== 'string' || !row.peerId.trim() || row.peerId.length > 200) {
    throw new Error('Pairing response peerId was invalid');
  }
  if (typeof row.label !== 'string' || !row.label.trim() || row.label.length > 80) {
    throw new Error('Pairing response label was invalid');
  }
  if (
    typeof row.inboundToken !== 'string' ||
    !row.inboundToken.startsWith('lbpeer_') ||
    row.inboundToken.length < 20 ||
    row.inboundToken.length > 300
  ) {
    throw new Error('Pairing response token was invalid');
  }
  if (
    typeof row.quotaBytes !== 'number' ||
    !Number.isSafeInteger(row.quotaBytes) ||
    row.quotaBytes <= 0
  ) {
    throw new Error('Pairing response quota was invalid');
  }
  const rawBase = typeof row.baseUrl === 'string' && row.baseUrl.trim()
    ? row.baseUrl.trim()
    : fallbackBaseUrl;
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    throw new Error('Pairing response URL was invalid');
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.hash
  ) {
    throw new Error('Pairing response URL was invalid');
  }
  return {
    peerId: row.peerId.trim(),
    label: row.label.trim(),
    baseUrl: baseUrl.toString().replace(/\/+$/, ''),
    inboundToken: row.inboundToken,
    quotaBytes: row.quotaBytes,
  };
}

/**
 * Accept a LazyBackup invite as an outbound-only LazyBro client.
 */
export async function acceptInvite(
  cfg: BroConfig,
  inviteCode: string,
  label?: string
): Promise<BroConfig> {
  const payload = decodeInvitePayload(inviteCode);
  const ourInbound = generatePeerToken();
  const ourPeerId = nanoid();
  const pairUrl = `${payload.u.replace(/\/+$/, '')}/api/peers/pair`;

  const res = await safeRemoteFetch(pairUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: payload.c,
      secret: payload.s,
      acceptor: {
        peerId: ourPeerId,
        mode: 'client',
        label: (label || cfg.label || 'LazyBro').trim(),
        inboundToken: ourInbound.token,
        quotaBytes: payload.q,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Pairing failed (${res.status})`
    );
  }

  const remote = parsePairingResponse(await res.json(), payload.u);

  cfg.hostBaseUrl = remote.baseUrl;
  cfg.outboundToken = remote.inboundToken;
  cfg.localPeerId = ourPeerId;
  cfg.remotePeerId = remote.peerId;
  cfg.remoteLabel = remote.label || payload.n;
  cfg.quotaBytes = remote.quotaBytes || payload.q;
  cfg.label = (label || cfg.label || 'LazyBro').trim();
  saveConfig(cfg);
  return cfg;
}
