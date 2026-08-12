import { createHash, randomBytes } from 'crypto';
import { PEER_TOKEN_PREFIX } from './types';

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

export function generateInviteCode(): string {
  // Short, non-tech-friendly code (no ambiguous chars)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function generateInviteSecret(): string {
  return randomBytes(24).toString('base64url');
}

export function hashInviteSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Compact invite payload for copy/paste (non-tech bro). */
export type InvitePayload = {
  v: 1;
  /** Remote base URL of the inviter */
  u: string;
  /** Invite code */
  c: string;
  /** Invite secret */
  s: string;
  /** Quota bytes */
  q: number;
  /** Inviter label */
  n: string;
};

export function encodeInvitePayload(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  return `lb1.${Buffer.from(json, 'utf8').toString('base64url')}`;
}

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
