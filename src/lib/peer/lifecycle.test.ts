import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createPinnedLookup as realCreatePinnedLookup,
  pinnedFetch as realPinnedFetch,
} from '@/lib/net/pinned-fetch';
import {
  resolveHttpUrlAddresses as realResolveHttpUrlAddresses,
  validateHttpUrlResolved as realValidateHttpUrlResolved,
  validatePeerUrlResolved as realValidatePeerUrlResolved,
} from '@/lib/net/url-guard-resolve';
import { hashInviteSecret } from './tokens';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-lifecycle-'));
const prevBackupStorage = process.env.BACKUP_STORAGE_PATH;
process.env.BACKUP_STORAGE_PATH = tmp;

const client = createClient({ url: `file:${path.join(tmp, 'lifecycle.db')}` });
const schema = await import('@/lib/db/schema');
const testDb = drizzle(client, { schema });

type PairRequest = { url: string; body: { acceptor: { peerId: string } } };
let pairRequests: PairRequest[] = [];
let pairResponse: Record<string, unknown> | null = null;
let pairError: Error | null = null;

mock.module('@/lib/db', () => ({ db: testDb }));
mock.module('@/lib/net/url-guard-resolve', () => ({
  validatePeerUrlResolved: async (url: string) => ({ ok: true, url }),
  validateHttpUrlResolved: realValidateHttpUrlResolved,
  resolveHttpUrlAddresses: realResolveHttpUrlAddresses,
}));
mock.module('@/lib/net/pinned-fetch', () => ({
  pinnedFetch: async (url: string, _policy: unknown, init?: { body?: string }) => {
    if (pairError) throw pairError;
    pairRequests.push({ url, body: JSON.parse(init?.body || '{}') as PairRequest['body'] });
    if (!pairResponse) throw new Error('no pair response configured');
    return Response.json(pairResponse);
  },
  createPinnedLookup: realCreatePinnedLookup,
}));

const { acceptInvite, completePairFromAcceptor, removePeer, renamePeer } = await import(
  './pairing'
);
const { encodeInvitePayload, generatePeerToken } = await import('./tokens');

const PEER_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  remote_base_url TEXT NOT NULL DEFAULT '',
  remote_peer_id TEXT,
  outbound_token TEXT,
  inbound_token_hash TEXT NOT NULL,
  inbound_token_prefix TEXT NOT NULL,
  quota_bytes INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  transport TEXT NOT NULL DEFAULT 'mailbox',
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at INTEGER,
  last_activity_at INTEGER,
  remote_used_bytes INTEGER,
  remote_quota_bytes INTEGER,
  remote_last_error TEXT,
  remote_last_sync_at INTEGER,
  remote_app_version TEXT,
  remote_reported_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
`;

await client.execute(`CREATE TABLE peers (${PEER_COLUMNS})`);
await client.execute(`
  CREATE TABLE peer_invites (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL,
    quota_bytes INTEGER NOT NULL,
    local_base_url TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER NOT NULL,
    peer_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
await client.execute(`CREATE TABLE peer_recalls (peer_id TEXT NOT NULL)`);
await client.execute(`CREATE TABLE peer_deletes (peer_id TEXT NOT NULL)`);
await client.execute(`
  CREATE TABLE backup_configs (
    id TEXT PRIMARY KEY NOT NULL,
    destination_peer_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
await client.execute(`
  CREATE TABLE backup_history (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_path TEXT,
    artifact_removed INTEGER NOT NULL DEFAULT 0,
    artifact_removed_reason TEXT,
    config_snapshot TEXT,
    mailbox_pending INTEGER NOT NULL DEFAULT 0
  )
`);

function token() {
  return generatePeerToken();
}

async function insertPeer(overrides: Partial<typeof schema.peers.$inferInsert> = {}) {
  const inbound = token();
  const row: typeof schema.peers.$inferInsert = {
    id: 'peer_old',
    name: 'Friend',
    remoteBaseUrl: 'http://friend.test',
    remotePeerId: 'remote-old',
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    inboundTokenHash: inbound.hash,
    inboundTokenPrefix: inbound.prefix,
    quotaBytes: 1024 * 1024 * 1024,
    usedBytes: 0,
    transport: 'mailbox',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  await testDb.insert(schema.peers).values(row);
  return row;
}

async function insertInvite(options: {
  id: string;
  code: string;
  secret: string;
  quotaBytes: number;
  status?: 'pending' | 'accepted';
  peerId?: string | null;
}) {
  await testDb.insert(schema.peerInvites).values({
    id: options.id,
    code: options.code,
    secretHash: hashInviteSecret(options.secret),
    quotaBytes: options.quotaBytes,
    localBaseUrl: 'http://me.test',
    label: 'Me',
    status: options.status || 'pending',
    expiresAt: new Date(Date.now() + 3600_000),
    peerId: options.peerId ?? null,
    createdAt: new Date(),
  });
}

beforeEach(async () => {
  pairRequests = [];
  pairResponse = null;
  pairError = null;
  for (const table of [
    'peers',
    'peer_invites',
    'peer_recalls',
    'peer_deletes',
    'backup_configs',
    'backup_history',
  ]) {
    await client.execute(`DELETE FROM ${table}`);
  }
  await fs.rm(path.join(tmp, 'peers'), { recursive: true, force: true });
  await fs.rm(path.join(tmp, 'peers-staging'), { recursive: true, force: true });
  await fs.rm(path.join(tmp, 'peers-recall'), { recursive: true, force: true });
});

afterAll(async () => {
  if (prevBackupStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
  else process.env.BACKUP_STORAGE_PATH = prevBackupStorage;
  client.close();
  await fs.rm(tmp, { recursive: true, force: true });
  // Bun module mocks are process-wide: put the real modules back for later files.
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  mock.module('@/lib/net/url-guard-resolve', () => ({
    validateHttpUrlResolved: realValidateHttpUrlResolved,
    resolveHttpUrlAddresses: realResolveHttpUrlAddresses,
    validatePeerUrlResolved: realValidatePeerUrlResolved,
  }));
  mock.module('@/lib/net/pinned-fetch', () => ({
    pinnedFetch: realPinnedFetch,
    createPinnedLookup: realCreatePinnedLookup,
  }));
});

describe('acceptInvite', () => {
  test('refuses an invite generated by this instance', async () => {
    const payload = {
      v: 1 as const,
      u: 'http://me.test',
      c: 'SELF-0001',
      s: 'secret',
      q: 1024,
      n: 'Me',
    };
    await insertInvite({ id: 'inv-self', code: payload.c, secret: payload.s, quotaBytes: payload.q });

    await expect(
      acceptInvite({
        inviteCode: encodeInvitePayload(payload),
        localLabel: 'Me',
        localBaseUrl: 'http://me.test',
      })
    ).rejects.toThrow(/your own invite/i);
    expect(pairRequests).toHaveLength(0);
  });

  test('names an unreachable invite URL instead of leaking a socket error', async () => {
    pairError = new Error('connect ECONNREFUSED 127.0.0.1:3000');
    const payload = {
      v: 1 as const,
      u: 'http://friend.test',
      c: 'FRIEND-1',
      s: 'secret',
      q: 1024,
      n: 'Friend',
    };
    let caught: Error | null = null;
    try {
      await acceptInvite({
        inviteCode: encodeInvitePayload(payload),
        localLabel: 'Me',
        localBaseUrl: 'http://me.test',
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('http://friend.test');
    expect(caught?.message).toContain('ALLOW_PRIVATE_PEER_URLS');
    expect(caught?.message).not.toContain('ECONNREFUSED');
  });

  test('re-pairing the same remote instance updates the existing row', async () => {
    await insertPeer();
    pairResponse = {
      peerId: 'remote-new',
      label: 'Friend renamed',
      baseUrl: 'http://friend.test',
      inboundToken: 'lbpeer_' + 'b'.repeat(64),
      quotaBytes: 2 * 1024 * 1024 * 1024,
    };
    const payload = {
      v: 1 as const,
      u: 'http://friend.test',
      c: 'REPAIR-1',
      s: 'secret',
      q: 2 * 1024 * 1024 * 1024,
      n: 'Friend',
    };

    const peer = await acceptInvite({
      inviteCode: encodeInvitePayload(payload),
      localLabel: 'Me',
      localBaseUrl: 'http://me.test',
    });

    expect(peer.id).toBe('peer_old');
    expect(peer.name).toBe('Friend renamed');
    expect(peer.remotePeerId).toBe('remote-new');
    const rows = await testDb.select().from(schema.peers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outboundToken).toBe('lbpeer_' + 'b'.repeat(64));
    // The acceptor reuses its peer id so the remote updates the same pair.
    expect(pairRequests[0]?.body.acceptor.peerId).toBe('peer_old');
  });
});

describe('completePairFromAcceptor', () => {
  test('shows a detailed quota mismatch instead of a generic failure', async () => {
    await insertInvite({ id: 'inv-quota', code: 'QUOT-0001', secret: 'sekret', quotaBytes: 1024 });
    await expect(
      completePairFromAcceptor({
        code: 'QUOT-0001',
        secret: 'sekret',
        acceptor: {
          peerId: 'acceptor-1',
          baseUrl: 'http://friend.test',
          mode: 'host',
          label: 'Friend',
          inboundToken: 'lbpeer_' + 'c'.repeat(64),
          quotaBytes: 2048,
        },
      })
    ).rejects.toThrow(/Quota mismatch/i);
  });

  test('re-pairing updates the peer row instead of creating a duplicate', async () => {
    const inboundOne = token();
    await insertInvite({ id: 'inv-a', code: 'PAIR-0001', secret: 'one', quotaBytes: 1024 });
    await completePairFromAcceptor({
      code: 'PAIR-0001',
      secret: 'one',
      acceptor: {
        peerId: 'acceptor-stable',
        baseUrl: 'http://friend.test',
        mode: 'host',
        label: 'Friend',
        inboundToken: inboundOne.token,
        quotaBytes: 1024,
      },
    });

    const inboundTwo = token();
    await insertInvite({ id: 'inv-b', code: 'PAIR-0002', secret: 'two', quotaBytes: 1024 });
    await completePairFromAcceptor({
      code: 'PAIR-0002',
      secret: 'two',
      acceptor: {
        peerId: 'acceptor-stable',
        baseUrl: 'http://friend.test',
        mode: 'host',
        label: 'Friend v2',
        inboundToken: inboundTwo.token,
        quotaBytes: 1024,
      },
    });

    const rows = await testDb.select().from(schema.peers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Friend v2');
    expect(rows[0]?.remotePeerId).toBe('acceptor-stable');
    expect(rows[0]?.outboundToken).toBe(inboundTwo.token);
  });
});

describe('renamePeer', () => {
  test('updates the display name', async () => {
    await insertPeer();
    const peer = await renamePeer('peer_old', '  New name  ');
    expect(peer.name).toBe('New name');
    const row = await testDb.query.peers.findFirst();
    expect(row?.name).toBe('New name');
  });

  test('rejects an empty name', async () => {
    await insertPeer();
    await expect(renamePeer('peer_old', '   ')).rejects.toThrow(/name/i);
  });
});

describe('removePeer', () => {
  test('revokes, disables backups, purges staging/inbound/recall data and rows', async () => {
    await insertPeer();
    await insertInvite({
      id: 'inv-linked',
      code: 'LINK-0001',
      secret: 'x',
      quotaBytes: 1024,
      status: 'accepted',
      peerId: 'peer_old',
    });
    await client.execute(
      `INSERT INTO backup_configs (id, destination_peer_id, enabled) VALUES
        ('cfg-peer', 'peer_old', 1), ('cfg-other', 'peer_other', 1)`
    );
    await client.execute(`INSERT INTO peer_recalls (peer_id) VALUES ('peer_old')`);
    await client.execute(`INSERT INTO peer_deletes (peer_id) VALUES ('peer_old')`);
    await client.execute(
      `INSERT INTO backup_history (id, artifact_path) VALUES ('h-old', 'peer://peer_old/old.age')`
    );

    const stagedFile = path.join(tmp, 'peers-staging', 'peer_old', 'a.age');
    const inboundFile = path.join(tmp, 'peers', 'peer_old', 'b.age');
    const recallFile = path.join(tmp, 'peers-recall', 'peer_old', 'r1', 'artifact');
    await fs.mkdir(path.dirname(stagedFile), { recursive: true });
    await fs.mkdir(path.dirname(inboundFile), { recursive: true });
    await fs.mkdir(path.dirname(recallFile), { recursive: true });
    await fs.writeFile(stagedFile, Buffer.alloc(5, 1));
    await fs.writeFile(inboundFile, Buffer.alloc(7, 2));
    await fs.writeFile(recallFile, Buffer.alloc(3, 3));

    const result = await removePeer('peer_old');

    expect(result).toEqual({ removed: true, disabledBackups: 1, freedBytes: 15 });
    expect(await testDb.query.peers.findFirst()).toBeUndefined();
    const configs = await client.execute(
      'SELECT id, enabled FROM backup_configs ORDER BY id'
    );
    expect(configs.rows.find((c) => c.id === 'cfg-peer')?.enabled).toBe(0);
    expect(configs.rows.find((c) => c.id === 'cfg-other')?.enabled).toBe(1);
    const invite = await testDb.query.peerInvites.findFirst();
    expect(invite?.peerId).toBeNull();
    const recalls = await client.execute('SELECT * FROM peer_recalls');
    expect(recalls.rows).toHaveLength(0);
    const deletes = await client.execute('SELECT * FROM peer_deletes');
    expect(deletes.rows).toHaveLength(0);
    const history = await client.execute(
      "SELECT artifact_removed, artifact_removed_reason FROM backup_history WHERE id = 'h-old'"
    );
    expect(history.rows[0]?.artifact_removed).toBe(1);
    expect(String(history.rows[0]?.artifact_removed_reason)).toContain(
      'removed from Bro Space'
    );
    expect(await fs.stat(path.join(tmp, 'peers-staging', 'peer_old')).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(tmp, 'peers', 'peer_old')).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(tmp, 'peers-recall', 'peer_old')).catch(() => null)).toBeNull();
  });

  test('does not flag another peer history when the id contains a LIKE wildcard', async () => {
    await insertPeer({ id: 'peer_a_b', name: 'Underscore' });
    await insertPeer({ id: 'peer_aXb', name: 'Other' });
    await client.execute(
      `INSERT INTO backup_history (id, artifact_path) VALUES
        ('h-under', 'peer://peer_a_b/old.age'),
        ('h-other', 'peer://peer_aXb/keep.age')`
    );

    await removePeer('peer_a_b');

    const rows = await client.execute(
      'SELECT id, artifact_removed FROM backup_history ORDER BY id'
    );
    expect(rows.rows.find((row) => row.id === 'h-under')?.artifact_removed).toBe(1);
    expect(rows.rows.find((row) => row.id === 'h-other')?.artifact_removed).toBe(0);
  });

  test('returns null for an unknown peer', async () => {
    expect(await removePeer('missing')).toBeNull();
  });
});
