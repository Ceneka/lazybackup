import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as realPinned from '@/lib/net/pinned-fetch';
import * as realGuard from '@/lib/net/url-guard';
import type { PeerRow } from './types';

type Call = { url: string; method: string };
let calls: Call[] = [];
let peerUpdates: Array<Record<string, unknown>> = [];
let workStatus = 200;

mock.module('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        peerUpdates.push(values);
        return { where: async () => undefined };
      },
    }),
    query: { peers: { findMany: async () => [] } },
  },
}));

mock.module('@/lib/net/url-guard', () => ({
  peerUrlPolicy: () => ({
    allowPrivate: true,
    allowCgnat: true,
    allowHttp: true,
    label: 'Peer URL',
  }),
}));

mock.module('@/lib/net/pinned-fetch', () => ({
  pinnedFetch: async (url: string, _policy: unknown, init?: { method?: string }) => {
    const method = init?.method || 'GET';
    calls.push({ url, method });
    const parsed = new URL(url);
    if (parsed.pathname === '/api/peers/agent/ping') return Response.json({ ok: true });
    if (parsed.pathname === '/api/peers/agent/work') {
      if (workStatus !== 200) {
        return Response.json({ error: 'Unauthorized peer' }, { status: workStatus });
      }
      return Response.json({
        pulls: [{ key: 'oversized.age', size: 100 }],
        recalls: [{ id: 'r1', objectKey: 'restore.bin' }],
        deletes: [{ key: 'old.age' }],
      });
    }
    if (parsed.pathname === '/api/peers/agent/pending') {
      // Mismatched Content-Length: the pull must fail without aborting the pass.
      return new Response(Buffer.alloc(5, 1), {
        headers: { 'Content-Length': '5' },
      });
    }
    if (parsed.pathname === '/api/peers/agent/ack') return Response.json({ ok: true });
    if (parsed.pathname.startsWith('/api/peers/agent/recall/')) {
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
}));

const { syncPeerOnce } = await import('./sync-worker');

afterAll(() => {
  mock.module('@/lib/net/pinned-fetch', () => realPinned);
  mock.module('@/lib/net/url-guard', () => realGuard);
});

function peer(overrides: Partial<PeerRow> = {}): PeerRow {
  return {
    id: 'peer_a',
    name: 'Bro',
    remoteBaseUrl: 'http://peer.test:3000',
    remotePeerId: 'remote',
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    inboundTokenHash: 'hash',
    inboundTokenPrefix: 'lbpeer_aaa…',
    quotaBytes: 1024,
    usedBytes: 0,
    transport: 'mailbox',
    status: 'active',
    lastSeenAt: null,
    lastActivityAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('syncPeerOnce pull isolation', () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(async () => {
    prev = process.env.BACKUP_STORAGE_PATH;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-sync-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    calls = [];
    peerUpdates = [];
    workStatus = 200;
    // The recall source object exists in this peer's inbox.
    const recallObject = path.join(tmp, 'peers', 'peer_a', 'restore.bin');
    await fs.mkdir(path.dirname(recallObject), { recursive: true });
    await fs.writeFile(recallObject, Buffer.alloc(4, 7));
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('a failed pull still lets recalls and retention deletes run', async () => {
    await expect(syncPeerOnce(peer())).resolves.toBeUndefined();

    expect(
      calls.some(
        (c) => c.method === 'PUT' && c.url.includes('/api/peers/agent/recall/r1')
      )
    ).toBe(true);
    expect(
      calls.some((c) => c.method === 'POST' && c.url.includes('/api/peers/agent/ack'))
    ).toBe(true);
  });

  test('revoked peers are no longer dialed', async () => {
    await expect(
      syncPeerOnce(peer({ status: 'revoked' }))
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test('a 401 from the friend marks the peer revoked locally', async () => {
    workStatus = 401;
    await expect(syncPeerOnce(peer())).resolves.toBeUndefined();
    expect(
      calls.some((c) => c.url.includes('/api/peers/agent/work'))
    ).toBe(true);
    expect(peerUpdates).toContainEqual(
      expect.objectContaining({ status: 'revoked', outboundToken: null })
    );
    // No mailbox work is attempted against a pairing the friend rejected.
    expect(
      calls.some((c) => c.url.includes('/api/peers/agent/pending'))
    ).toBe(false);
  });
});
