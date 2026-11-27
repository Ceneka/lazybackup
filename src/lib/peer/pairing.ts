import { and, eq, inArray, like } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import {
  backupConfigs,
  backupHistory,
  peerDeletes,
  peerInvites,
  peerRecalls,
  peers,
  settings,
} from '@/lib/db/schema';
import {
  PEER_PAIR_RESPONSE_JSON_LIMIT,
  readCappedResponseJson,
} from '@/lib/net/capped-json';
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
import { parsePeerArtifactPath } from './delivery-state';
import fs from 'fs/promises';
import path from 'path';
import { peerRecallDir } from './recall';
import { peerDataDir } from './storage';
import { listStagedObjects, peerStagingDir, peerStagingTempDir } from './staging';

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
    'Instance URL must use https:// for a public address, or a LAN/Tailscale address. Set ALLOW_PRIVATE_PEER_URLS=true for LAN.'
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
  // History rows can still be `mailboxPending` for a few ms after the ACK
  // removed the staged file (ACK wins the race before the success row exists).
  // Keep this slim: /api/peers polls every 15 s, so pulling log_output /
  // config_snapshot for every pending row is pure page-cache pressure.
  // `deliveryState` is derived (waiting/failed), not a stored column.
  const pendingHistory = await db.query.backupHistory
    .findMany({
      where: eq(backupHistory.mailboxPending, true),
      columns: {
        id: true,
        configId: true,
        artifactPath: true,
        totalSize: true,
        transferredSize: true,
        startTime: true,
        mailboxPending: true,
      },
    })
    .catch(() => []);
  // Bucket once by peer id instead of rescanning every pending row per peer.
  // Index the element type explicitly: `typeof pendingHistory` is a union with
  // the `.catch(() => [])` branch, whose `push` parameter collapses to `never`.
  const pendingByPeer = new Map<string, (typeof pendingHistory)[number][]>();
  for (const history of pendingHistory) {
    const ref = parsePeerArtifactPath(history.artifactPath);
    if (!ref) continue;
    const bucket = pendingByPeer.get(ref.peerId);
    if (bucket) bucket.push(history);
    else pendingByPeer.set(ref.peerId, [history]);
  }
  const out: PeerPublic[] = [];
  for (const row of rows) {
    const pending = new Map<string, { size: number; at: string }>();
    if (row.transport !== 'direct') {
      try {
        for (const staged of await listStagedObjects(row.id)) {
          pending.set(staged.key, { size: staged.size, at: staged.mtime });
        }
      } catch {
        // Missing staging dir = nothing waiting.
      }
    }
    const prefix = `peer://${row.id}/`;
    for (const history of pendingByPeer.get(row.id) ?? []) {
      const artifactPath = history.artifactPath;
      if (!artifactPath?.startsWith(prefix)) continue;
      const key = artifactPath.slice(prefix.length);
      if (!key || pending.has(key)) continue;
      pending.set(key, {
        size: history.totalSize ?? history.transferredSize ?? 0,
        at: new Date(history.startTime).toISOString(),
      });
    }
    const pendingBytes = [...pending.values()].reduce((sum, item) => sum + item.size, 0);
    const oldestPendingAt =
      [...pending.values()].map((item) => item.at).sort()[0] ?? null;
    out.push(
      redactPeer(row, {
        pendingSyncCount: pending.size,
        pendingBytes,
        oldestPendingAt,
      })
    );
  }
  return out;
}

function normalizePeerUrlForCompare(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Refuse to pair this instance with itself. The invite code is checked too so a
 * changed Instance URL does not make a self-invite slip through.
 */
async function assertNotOwnInvite(payload: InvitePayload, ourBaseUrl: string): Promise<void> {
  const ownInvite = await db.query.peerInvites.findFirst({
    where: eq(peerInvites.code, payload.c),
  });
  if (ownInvite) {
    throw new Error("That's your own invite. Share it with your friend instead.");
  }
  if (
    ourBaseUrl &&
    payload.u &&
    normalizePeerUrlForCompare(ourBaseUrl) === normalizePeerUrlForCompare(payload.u)
  ) {
    throw new Error("That's your own invite. Share it with your friend instead.");
  }
}

async function findExistingPeerForRemote(options: {
  remotePeerId?: string | null;
  remoteBaseUrl?: string | null;
}): Promise<typeof peers.$inferSelect | null> {
  if (options.remotePeerId) {
    const byId = await db.query.peers.findFirst({
      where: eq(peers.remotePeerId, options.remotePeerId),
    });
    if (byId) return byId;
  }
  if (options.remoteBaseUrl) {
    const byUrl = await db.query.peers.findFirst({
      where: eq(peers.remoteBaseUrl, options.remoteBaseUrl),
    });
    if (byUrl) return byUrl;
  }
  return null;
}

function formatQuotaGb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GB`;
}

export async function renamePeer(peerId: string, name: string): Promise<PeerPublic> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Peer name is required');
  }
  if (trimmed.length > 80) {
    throw new Error('Peer name must be 80 characters or fewer');
  }
  const updated = await db
    .update(peers)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(peers.id, peerId))
    .returning();
  const row = updated[0];
  if (!row) {
    throw new Error('Peer not found');
  }
  return redactPeer(row);
}

async function dirBytes(dir: string): Promise<number> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirBytes(full);
    } else if (entry.isFile()) {
      total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

export type RemovePeerResult = {
  removed: true;
  disabledBackups: number;
  freedBytes: number;
};

/**
 * Fully remove a paired peer from this host:
 * revoke it (stop dialing), disable backups that point to it, purge staged /
 * inbound / recall data + rows, and delete the peer row.
 */
export async function removePeer(peerId: string): Promise<RemovePeerResult | null> {
  const peer = await db.query.peers.findFirst({ where: eq(peers.id, peerId) });
  if (!peer) return null;

  if (peer.status === 'active') {
    await revokePeer(peerId);
  }

  const affectedConfigs = await db
    .select({ id: backupConfigs.id })
    .from(backupConfigs)
    .where(eq(backupConfigs.destinationPeerId, peerId));
  if (affectedConfigs.length > 0) {
    const { stopBackup } = await import('@/lib/scheduler');
    for (const config of affectedConfigs) {
      stopBackup(config.id);
    }
    await db
      .update(backupConfigs)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(backupConfigs.destinationPeerId, peerId));
  }

  const dirs = [
    peerStagingDir(peerId),
    peerStagingTempDir(peerId),
    peerDataDir(peerId),
    peerRecallDir(peerId),
  ];
  let freedBytes = 0;
  for (const dir of dirs) {
    freedBytes += await dirBytes(dir);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // Artifacts of a removed peer can never be recalled again: mark their history
  // rows so restore fails with a clear reason instead of a missing-peer error.
  // Compare prefixes in JS: peer ids are nanoid (`_` is legal) and SQL LIKE
  // would treat `_`/`%` as wildcards, flagging another peer's rows too.
  const peerArtifactPrefix = `peer://${peerId}/`;
  const peerArtifacts = await db
    .select({ id: backupHistory.id, artifactPath: backupHistory.artifactPath })
    .from(backupHistory)
    .where(like(backupHistory.artifactPath, 'peer://%'));
  const removedHistoryIds = peerArtifacts
    .filter((row) => row.artifactPath?.startsWith(peerArtifactPrefix))
    .map((row) => row.id);
  if (removedHistoryIds.length > 0) {
    await db
      .update(backupHistory)
      .set({
        artifactRemoved: true,
        artifactRemovedReason:
          'This backup was stored on a bro that was removed from Bro Space',
        mailboxPending: false,
      })
      .where(inArray(backupHistory.id, removedHistoryIds));
  }

  await db.delete(peerRecalls).where(eq(peerRecalls.peerId, peerId));
  await db.delete(peerDeletes).where(eq(peerDeletes.peerId, peerId));
  await db
    .update(peerInvites)
    .set({ peerId: null })
    .where(eq(peerInvites.peerId, peerId));
  await db.delete(peers).where(eq(peers.id, peerId));

  return {
    removed: true,
    disabledBackups: affectedConfigs.length,
    freedBytes,
  };
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
  const remoteRaw = (payload.u || '').replace(/\/+$/, '');

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

  await assertNotOwnInvite(payload, ourBaseUrl);

  const remoteCheck = await validatePeerUrlResolved(remoteRaw);
  if (!remoteCheck.ok) {
    throw new Error(
      `Cannot use the invite address ${remoteRaw || '(empty)'}: ${remoteCheck.error}. Check the address, use Tailscale, or set ALLOW_PRIVATE_PEER_URLS=true for a LAN address.`
    );
  }
  const remoteBase = remoteCheck.url.replace(/\/+$/, '');

  // Re-pairing the same remote instance must update its peer row (and keep the
  // existing peer id, staging data, and quota) instead of creating a duplicate.
  const existingBefore = await findExistingPeerForRemote({ remoteBaseUrl: remoteBase });
  const ourInbound = generatePeerToken();
  const ourPeerId = existingBefore?.id ?? nanoid();

  const pairUrl = `${remoteBase}/api/peers/pair`;
  let res: Response;
  try {
    res = await pinnedFetch(pairUrl, peerUrlPolicy(), {
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
  } catch {
    // Never surface raw socket errors (connect ECONNREFUSED, EAI_AGAIN, …).
    throw new Error(
      `Could not reach ${remoteBase}. Check the address, make sure the other instance is online, and use Tailscale or set ALLOW_PRIVATE_PEER_URLS=true if it is on your LAN.`
    );
  }

  if (!res.ok) {
    const err = await readCappedResponseJson(res, PEER_PAIR_RESPONSE_JSON_LIMIT).catch(
      () => ({})
    );
    throw new Error(
      (err as { error?: string }).error || `Pairing failed (${res.status})`
    );
  }

  const remote = (await readCappedResponseJson(
    res,
    PEER_PAIR_RESPONSE_JSON_LIMIT
  )) as {
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

  const existing =
    (await findExistingPeerForRemote({
      remotePeerId: remote.peerId,
      remoteBaseUrl: storedRemoteUrl,
    })) ?? existingBefore;
  const peerId = existing?.id ?? ourPeerId;
  const values = {
    name: remote.label || payload.n || 'Bro',
    remoteBaseUrl: storedRemoteUrl,
    remotePeerId: remote.peerId,
    outboundToken: remote.inboundToken,
    inboundTokenHash: ourInbound.hash,
    inboundTokenPrefix: ourInbound.prefix,
    quotaBytes: payload.q,
    transport: 'mailbox' as const,
    status: 'active' as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(peers).set(values).where(eq(peers.id, existing.id));
  } else {
    await db.insert(peers).values({
      id: peerId,
      ...values,
      usedBytes: 0,
      createdAt: new Date(),
    });
  }

  await fs.mkdir(peerDataDir(peerId), { recursive: true });

  const row = await db.query.peers.findFirst({ where: eq(peers.id, peerId) });
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
  // Verify the secret before revealing anything about the invite state
  // (expired vs missing) so this endpoint is not an invite oracle.
  const presented = Buffer.from(hashInviteSecret(body.secret), 'utf8')
  const expected = Buffer.from(invite.secretHash, 'utf8')
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    throw new Error(PAIRING_FAILED_MESSAGE);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await db
      .update(peerInvites)
      .set({ status: 'expired' })
      .where(eq(peerInvites.id, invite.id));
    throw new Error('Invite has expired. Ask your bro for a new one.');
  }
  if (body.acceptor.quotaBytes !== invite.quotaBytes) {
    // Secret already verified above, so it is safe to explain the mismatch.
    throw new Error(
      `Quota mismatch: the invite is for ${formatQuotaGb(invite.quotaBytes)} but the pairing request offered ${formatQuotaGb(body.acceptor.quotaBytes)}. Ask for a new invite.`
    );
  }

  const mode = body.acceptor.mode || 'host';
  const acceptorUrl = (body.acceptor.baseUrl || '').replace(/\/+$/, '');
  if (mode === 'host' && !acceptorUrl) {
    throw new Error('Acceptor baseUrl is required for host mode');
  }
  if (mode === 'host') {
    const urlCheck = await validatePeerUrlResolved(acceptorUrl);
    if (!urlCheck.ok) {
      throw new Error(
        `Cannot use the accepting instance address ${acceptorUrl}: ${urlCheck.error}. Use Tailscale or set ALLOW_PRIVATE_PEER_URLS=true for a LAN address.`
      );
    }
  }

  const ourInbound = generatePeerToken();
  const ourBase = invite.localBaseUrl;
  const storedAcceptorUrl = mode === 'client' ? '' : acceptorUrl;

  // Re-pairing the same remote instance updates its row instead of creating a
  // duplicate (the acceptor may have rotated its token/keys).
  const existing = await findExistingPeerForRemote({
    remotePeerId: body.acceptor.peerId,
    remoteBaseUrl: storedAcceptorUrl,
  });
  const ourPeerId = existing?.id ?? nanoid();
  const values = {
    name: body.acceptor.label || 'Bro',
    remoteBaseUrl: storedAcceptorUrl,
    remotePeerId: body.acceptor.peerId,
    outboundToken: body.acceptor.inboundToken,
    inboundTokenHash: ourInbound.hash,
    inboundTokenPrefix: ourInbound.prefix,
    quotaBytes: invite.quotaBytes,
    transport: 'mailbox' as const,
    status: 'active' as const,
    updatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    const claimed = await consumePendingInvite(invite.id, tx);
    if (!claimed) {
      throw new Error(PAIRING_FAILED_MESSAGE);
    }

    if (existing) {
      await tx.update(peers).set(values).where(eq(peers.id, existing.id));
    } else {
      await tx.insert(peers).values({
        id: ourPeerId,
        ...values,
        usedBytes: 0,
        createdAt: new Date(),
      });
    }

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
