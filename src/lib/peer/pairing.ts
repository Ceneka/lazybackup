import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { peerInvites, peers, settings } from '@/lib/db/schema';
import { peerUrlPolicy, validatePeerUrl } from '@/lib/net/url-guard';
import { validatePeerUrlResolved } from '@/lib/net/url-guard-resolve';
import { pinnedFetch } from '@/lib/net/pinned-fetch';
import {
  decodeInvitePayload,
  encodeInvitePayload,
  generateInviteCode,
  generateInviteSecret,
  generatePeerToken,
  hashInviteSecret,
  hashPeerToken,
  type InvitePayload,
} from './tokens';
import { INSTANCE_BASE_URL_KEY, gbToBytes, redactPeer, type PeerPublic } from './types';
import fs from 'fs/promises';
import { peerDataDir } from './storage';
import { listStagedObjects } from './staging';

/** Uniform public error for invite not found / bad secret / quota / already used. */
export const PAIRING_FAILED_MESSAGE = 'Pairing failed';

function assertPeerUrlOrThrow(raw: string, message?: string): string {
  const result = validatePeerUrl(raw);
  if (!result.ok) {
    throw new Error(message || result.error);
  }
  return result.url.replace(/\/+$/, '');
}

export async function getInstanceBaseUrl(): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, INSTANCE_BASE_URL_KEY),
  });
  return row?.value?.trim() || null;
}

export async function setInstanceBaseUrl(url: string): Promise<void> {
  const trimmed = assertPeerUrlOrThrow(
    url.trim().replace(/\/+$/, ''),
    'Instance URL must be a public http(s) address (or Tailscale). Set ALLOW_PRIVATE_PEER_URLS=true for LAN.'
  );
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, INSTANCE_BASE_URL_KEY),
  });
  if (existing) {
    await db
      .update(settings)
      .set({ value: trimmed, updatedAt: new Date() })
      .where(eq(settings.key, INSTANCE_BASE_URL_KEY));
    return;
  }
  await db.insert(settings).values({
    id: nanoid(),
    key: INSTANCE_BASE_URL_KEY,
    value: trimmed,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function listPeers(): Promise<PeerPublic[]> {
  const rows = await db.query.peers.findMany();
  const out: PeerPublic[] = [];
  for (const row of rows) {
    let pendingSyncCount = 0;
    if (row.transport !== 'direct') {
      try {
        pendingSyncCount = (await listStagedObjects(row.id)).length;
      } catch {
        pendingSyncCount = 0;
      }
    }
    out.push(redactPeer(row, { pendingSyncCount }));
  }
  return out;
}

export async function createInvite(options: {
  label: string;
  quotaGb: number;
  localBaseUrl?: string;
  ttlHours?: number;
}): Promise<{ inviteCode: string; payload: InvitePayload; expiresAt: Date }> {
  const rawBase = (options.localBaseUrl || (await getInstanceBaseUrl()) || '').replace(/\/+$/, '');
  if (!rawBase) {
    throw new Error(
      'Set your Instance URL in Settings → Bro Space so your bro can reach you.'
    );
  }
  const baseUrl = assertPeerUrlOrThrow(rawBase);
  if (options.quotaGb < 1 || options.quotaGb > 100000) {
    throw new Error('Quota must be between 1 and 100000 GB');
  }

  const code = generateInviteCode();
  const secret = generateInviteSecret();
  const quotaBytes = gbToBytes(options.quotaGb);
  const expiresAt = new Date(Date.now() + (options.ttlHours ?? 72) * 3600 * 1000);
  const id = nanoid();

  await db.insert(peerInvites).values({
    id,
    code,
    secretHash: hashInviteSecret(secret),
    quotaBytes,
    localBaseUrl: baseUrl,
    label: options.label.trim() || 'LazyBackup',
    status: 'pending',
    expiresAt,
    createdAt: new Date(),
  });

  const payload: InvitePayload = {
    v: 1,
    u: baseUrl,
    c: code,
    s: secret,
    q: quotaBytes,
    n: options.label.trim() || 'LazyBackup',
  };

  return { inviteCode: encodeInvitePayload(payload), payload, expiresAt };
}

export async function cancelInvite(inviteId: string): Promise<void> {
  await db
    .update(peerInvites)
    .set({ status: 'cancelled' })
    .where(eq(peerInvites.id, inviteId));
}

export async function listInvites() {
  return db.query.peerInvites.findMany();
}

/**
 * Accept a pasted invite on this instance (another full LB).
 * Calls the inviter's pair endpoint to complete mutual trust.
 */
export async function acceptInvite(options: {
  inviteCode: string;
  localLabel: string;
  localBaseUrl?: string;
  /** client = LazyBro-style (no local URL); host = full LB with URL */
  mode?: 'client' | 'host';
}): Promise<PeerPublic> {
  const payload = decodeInvitePayload(options.inviteCode);
  const remoteBase = (payload.u || '').replace(/\/+$/, '');
  const remoteCheck = await validatePeerUrlResolved(remoteBase);
  if (!remoteCheck.ok) {
    throw new Error(remoteCheck.error);
  }

  const mode = options.mode || 'host';
  const ourBaseUrl =
    mode === 'client'
      ? ''
      : (options.localBaseUrl || (await getInstanceBaseUrl()) || '').replace(/\/+$/, '');
  if (mode === 'host' && !ourBaseUrl) {
    throw new Error('Set your Instance URL in Settings → Bro Space before accepting.');
  }
  if (mode === 'host') {
    assertPeerUrlOrThrow(ourBaseUrl);
  }

  const ourInbound = generatePeerToken();
  const ourPeerId = nanoid();

  const pairUrl = `${remoteCheck.url.replace(/\/+$/, '')}/api/peers/pair`;
  const res = await pinnedFetch(pairUrl, peerUrlPolicy(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: payload.c,
      secret: payload.s,
      acceptor: {
        peerId: ourPeerId,
        baseUrl: ourBaseUrl || undefined,
        mode,
        label: options.localLabel.trim() || 'LazyBackup',
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

  const storedRemoteUrl = (remote.baseUrl || payload.u).replace(/\/+$/, '');
  if (storedRemoteUrl) {
    assertPeerUrlOrThrow(storedRemoteUrl);
  }

  await db.insert(peers).values({
    id: ourPeerId,
    name: remote.label || payload.n || 'Bro',
    remoteBaseUrl: storedRemoteUrl,
    remotePeerId: remote.peerId,
    outboundToken: remote.inboundToken,
    inboundTokenHash: ourInbound.hash,
    inboundTokenPrefix: ourInbound.prefix,
    quotaBytes: payload.q,
    usedBytes: 0,
    transport: 'mailbox',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await fs.mkdir(peerDataDir(ourPeerId), { recursive: true });

  const row = await db.query.peers.findFirst({ where: eq(peers.id, ourPeerId) });
  if (!row) throw new Error('Failed to create peer');
  return redactPeer(row);
}

/**
 * Atomically mark a pending invite accepted. Returns false if it was already consumed.
 */
export async function consumePendingInvite(
  inviteId: string,
  executor: Pick<typeof db, 'update'> = db
): Promise<boolean> {
  const claimed = await executor
    .update(peerInvites)
    .set({ status: 'accepted' })
    .where(and(eq(peerInvites.id, inviteId), eq(peerInvites.status, 'pending')))
    .returning({ id: peerInvites.id });
  return claimed.length > 0;
}

/**
 * Inviter side: validate invite + create peer from acceptor.
 */
export async function completePairFromAcceptor(body: {
  code: string;
  secret: string;
  acceptor: {
    peerId: string;
    baseUrl?: string;
    mode?: 'client' | 'host';
    label: string;
    inboundToken: string;
    quotaBytes: number;
  };
}): Promise<{
  peerId: string;
  label: string;
  baseUrl: string;
  inboundToken: string;
  quotaBytes: number;
}> {
  const invite = await db.query.peerInvites.findFirst({
    where: and(eq(peerInvites.code, body.code), eq(peerInvites.status, 'pending')),
  });
  if (!invite) {
    throw new Error(PAIRING_FAILED_MESSAGE);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await db
      .update(peerInvites)
      .set({ status: 'expired' })
      .where(eq(peerInvites.id, invite.id));
    throw new Error('Invite has expired. Ask your bro for a new one.');
  }
  if (hashInviteSecret(body.secret) !== invite.secretHash) {
    throw new Error(PAIRING_FAILED_MESSAGE);
  }
  if (body.acceptor.quotaBytes !== invite.quotaBytes) {
    throw new Error(PAIRING_FAILED_MESSAGE);
  }

  const mode = body.acceptor.mode || 'host';
  const acceptorUrl = (body.acceptor.baseUrl || '').replace(/\/+$/, '');
  if (mode === 'host' && !acceptorUrl) {
    throw new Error('Acceptor baseUrl is required for host mode');
  }
  if (mode === 'host') {
    const urlCheck = await validatePeerUrlResolved(acceptorUrl);
    if (!urlCheck.ok) {
      throw new Error(urlCheck.error);
    }
  }

  const ourInbound = generatePeerToken();
  const ourPeerId = nanoid();
  const ourBase = invite.localBaseUrl;
  const storedAcceptorUrl = mode === 'client' ? '' : acceptorUrl;

  await db.transaction(async (tx) => {
    const claimed = await consumePendingInvite(invite.id, tx);
    if (!claimed) {
      throw new Error(PAIRING_FAILED_MESSAGE);
    }

    await tx.insert(peers).values({
      id: ourPeerId,
      name: body.acceptor.label || 'Bro',
      remoteBaseUrl: storedAcceptorUrl,
      remotePeerId: body.acceptor.peerId,
      outboundToken: body.acceptor.inboundToken,
      inboundTokenHash: ourInbound.hash,
      inboundTokenPrefix: ourInbound.prefix,
      quotaBytes: invite.quotaBytes,
      usedBytes: 0,
      transport: 'mailbox',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await tx
      .update(peerInvites)
      .set({ peerId: ourPeerId })
      .where(eq(peerInvites.id, invite.id));
  });

  await fs.mkdir(peerDataDir(ourPeerId), { recursive: true });

  return {
    peerId: ourPeerId,
    label: invite.label,
    baseUrl: ourBase,
    inboundToken: ourInbound.token,
    quotaBytes: invite.quotaBytes,
  };
}

export async function verifyPeerBearer(
  authorizationHeader?: string | null
): Promise<typeof peers.$inferSelect | null> {
  if (!authorizationHeader) return null;
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return null;
  const token = m[1].trim();
  if (!token.startsWith('lbpeer_')) return null;
  const hash = hashPeerToken(token);
  const row = await db.query.peers.findFirst({
    where: and(eq(peers.inboundTokenHash, hash), eq(peers.status, 'active')),
  });
  return row ?? null;
}

export async function touchPeerSeen(peerId: string): Promise<void> {
  await db
    .update(peers)
    .set({ lastSeenAt: new Date(), lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(peers.id, peerId));
}

export async function revokePeer(peerId: string): Promise<void> {
  await db
    .update(peers)
    .set({ status: 'revoked', updatedAt: new Date(), outboundToken: null })
    .where(eq(peers.id, peerId));
}
