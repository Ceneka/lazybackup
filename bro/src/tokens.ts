import { createHash, randomBytes } from 'crypto';

export const PEER_TOKEN_PREFIX = 'lbpeer_';

export function hashPeerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generatePeerToken(): { token: string; hash: string; prefix: string } {
  const token = `${PEER_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  return {
    token,
    hash: hashPeerToken(token),
    prefix: token.slice(0, 12) + '…',
  };
}

export type InvitePayload = {
  v: 1;
  u: string;
  c: string;
  s: string;
  q: number;
  n: string;
};

export function decodeInvitePayload(raw: string): InvitePayload {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('lb1.')) {
    throw new Error('Invalid invite code. Paste the full code your bro shared.');
  }
  const json = Buffer.from(trimmed.slice(4), 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as InvitePayload;
  if (parsed.v !== 1 || !parsed.u || !parsed.c || !parsed.s || !parsed.q) {
    throw new Error('Invite code is incomplete or corrupted.');
  }
  return parsed;
}
