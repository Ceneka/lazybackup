import { nanoid } from 'nanoid';
import type { BroConfig } from './config';
import { saveConfig } from './config';
import { decodeInvitePayload, generatePeerToken } from './tokens';

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

  const res = await fetch(pairUrl, {
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

  const remote = (await res.json()) as {
    peerId: string;
    label: string;
    baseUrl: string;
    inboundToken: string;
    quotaBytes: number;
  };

  cfg.hostBaseUrl = remote.baseUrl || payload.u;
  cfg.outboundToken = remote.inboundToken;
  cfg.localPeerId = ourPeerId;
  cfg.remotePeerId = remote.peerId;
  cfg.remoteLabel = remote.label || payload.n;
  cfg.quotaBytes = remote.quotaBytes || payload.q;
  cfg.label = (label || cfg.label || 'LazyBro').trim();
  saveConfig(cfg);
  return cfg;
}
