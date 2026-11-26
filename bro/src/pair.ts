import { nanoid } from 'nanoid';
import type { BroConfig } from './config';
import { saveConfig } from './config';
import { readCappedJson } from './json-limit';
import { decodeInvitePayload, generatePeerToken } from './tokens';
import { safeRemoteFetch } from './remote';

const PAIR_RESPONSE_JSON_LIMIT = 256 * 1024;

/** Friend-facing pair errors (never raw parser/network text). */
export const PAIR_ADDRESS_MESSAGE =
  "Can't reach your friend's LazyBackup at that address. Ask them to check the address and send a new invite.";
export const PAIR_EXPIRED_MESSAGE =
  'This invite has expired. Ask your friend to send a new one.';
export const PAIR_USED_MESSAGE =
  'This invite has already been used. Ask your friend to send a new one.';
export const PAIR_GENERIC_MESSAGE =
  "Pairing didn't work. Ask your friend to send a new invite.";
export const PAIR_UNEXPECTED_REPLY_MESSAGE =
  "Your friend's LazyBackup sent an unexpected reply. Ask them to update LazyBackup and send a new invite.";
export const PAIR_TOO_MANY_MESSAGE = 'Too many tries. Wait a minute, then try again.';

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
 * Map transport failures (blocked address, DNS, refused, timeout) to a
 * sentence the friend can act on.
 */
export function friendlyPairTransportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/blocked|invalid|must be http|credentials|fragment/i.test(message)) {
    return PAIR_ADDRESS_MESSAGE;
  }
  if (
    /fetch failed|timed out|timeout|enotfound|econnrefused|econnreset|econnaborted|eai_again|getaddrinfo|socket hang up|network|unreachable|offline/i.test(
      message
    )
  ) {
    return PAIR_ADDRESS_MESSAGE;
  }
  return PAIR_GENERIC_MESSAGE;
}

/**
 * Map a non-2xx pairing reply. The host already speaks plain language for
 * expired invites; anything technical is replaced with friend-facing copy.
 */
export function friendlyPairReplyError(status: number, hostError: unknown): string {
  const message = typeof hostError === 'string' ? hostError.trim() : '';
  if (status === 429) return PAIR_TOO_MANY_MESSAGE;
  if (/expired/i.test(message)) return PAIR_EXPIRED_MESSAGE;
  if (/already|used|consumed|revok|not found|pairing failed|invalid invite/i.test(message)) {
    return PAIR_USED_MESSAGE;
  }
  if (/validation|json|unexpected|syntax|token|zod/i.test(message)) {
    return PAIR_GENERIC_MESSAGE;
  }
  if (status >= 500) return PAIR_GENERIC_MESSAGE;
  return message && message.length <= 200 ? message : PAIR_GENERIC_MESSAGE;
}

/**
 * The friend's display name. Explicit input wins; legacy default "LazyBro"
 * must never be sent as a person's name (bug B13).
 */
export function pairingName(label: string | undefined, current: string): string {
  const explicit = (label || '').trim();
  if (explicit) return explicit.slice(0, 80);
  const saved = (current || '').trim();
  if (saved && saved !== 'LazyBro') return saved.slice(0, 80);
  return 'Friend';
}

/** Remove remote pairing state. Stored objects are deleted by the caller. */
export function clearPairing(cfg: BroConfig): BroConfig {
  cfg.hostBaseUrl = null;
  cfg.outboundToken = null;
  cfg.localPeerId = null;
  cfg.remotePeerId = null;
  cfg.remoteLabel = null;
  cfg.quotaBytes = 0;
  return cfg;
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
  const name = pairingName(label, cfg.label);
  const ourInbound = generatePeerToken();
  const ourPeerId = nanoid();
  const pairUrl = `${payload.u.replace(/\/+$/, '')}/api/peers/pair`;

  let res: Response;
  try {
    res = await safeRemoteFetch(pairUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: payload.c,
        secret: payload.s,
        acceptor: {
          peerId: ourPeerId,
          mode: 'client',
          label: name,
          inboundToken: ourInbound.token,
          quotaBytes: payload.q,
        },
      }),
    });
  } catch (error) {
    throw new Error(friendlyPairTransportError(error));
  }

  if (!res.ok) {
    const err = await readCappedJson(res, PAIR_RESPONSE_JSON_LIMIT).catch(() => ({}));
    throw new Error(friendlyPairReplyError(res.status, (err as { error?: string }).error));
  }

  let remote: PairingResponse;
  try {
    remote = parsePairingResponse(
      await readCappedJson(res, PAIR_RESPONSE_JSON_LIMIT),
      payload.u
    );
  } catch {
    throw new Error(PAIR_UNEXPECTED_REPLY_MESSAGE);
  }

  cfg.hostBaseUrl = remote.baseUrl;
  cfg.outboundToken = remote.inboundToken;
  cfg.localPeerId = ourPeerId;
  cfg.remotePeerId = remote.peerId;
  cfg.remoteLabel = remote.label || payload.n;
  cfg.quotaBytes = remote.quotaBytes || payload.q;
  cfg.label = name;
  saveConfig(cfg);
  return cfg;
}
