import { createHash, randomBytes } from 'crypto';

export const PEER_TOKEN_PREFIX = 'lbpeer_';

/**
 * Friend-facing copy. Never surface base64/JSON parser text: a non-technical
 * friend cannot act on it, and it leaks implementation detail.
 */
export const INVITE_NOT_RIGHT_MESSAGE =
  "That invite doesn't look right. Copy the whole message from your friend — it starts with lb1.";
export const INVITE_INCOMPLETE_MESSAGE =
  'This invite is incomplete. Ask your friend to copy the whole message again.';

const INVITE_TOKEN_PATTERN = /lb1\.[A-Za-z0-9_-]{4,}/g;

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

/**
 * Pull the `lb1.…` code out of whatever the friend pasted. Friends usually
 * paste the whole message their friend sent, so surrounding text is fine.
 */
export function extractInviteCode(raw: string): string | null {
  const matches = raw.match(INVITE_TOKEN_PATTERN);
  if (!matches?.length) return null;
  return matches.reduce((longest, candidate) =>
    candidate.length > longest.length ? candidate : longest
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function decodeInvitePayload(raw: string): InvitePayload {
  const code = extractInviteCode(raw);
  if (!code) throw new Error(INVITE_NOT_RIGHT_MESSAGE);

  let parsed: unknown;
  try {
    const json = Buffer.from(code.slice(4), 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new Error(INVITE_NOT_RIGHT_MESSAGE);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(INVITE_NOT_RIGHT_MESSAGE);
  }

  const row = parsed as Record<string, unknown>;
  const valid =
    row.v === 1 &&
    typeof row.u === 'string' &&
    isHttpUrl(row.u) &&
    typeof row.c === 'string' &&
    row.c.length > 0 &&
    typeof row.s === 'string' &&
    row.s.length > 0 &&
    typeof row.q === 'number' &&
    Number.isSafeInteger(row.q) &&
    row.q > 0;
  if (!valid) throw new Error(INVITE_INCOMPLETE_MESSAGE);

  return {
    v: 1,
    u: row.u as string,
    c: row.c as string,
    s: row.s as string,
    q: row.q as number,
    n: typeof row.n === 'string' ? row.n : '',
  };
}
