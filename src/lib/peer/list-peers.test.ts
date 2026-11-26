import { afterAll, describe, expect, mock, test } from 'bun:test';
import * as realDb from '@/lib/db';
import * as realStaging from './staging';

type PeerFixture = Record<string, unknown>;
type StagedFixture = Array<{ key: string; size: number; mtime: string }>;

let peerRows: PeerFixture[] = [];
let stagedByPeer: Record<string, StagedFixture> = {};
let historyRows: Array<Record<string, unknown>> = [];

mock.module('@/lib/db', () => ({
  db: {
    query: {
      peers: { findMany: async () => peerRows },
      backupHistory: { findMany: async () => historyRows },
    },
  },
}));

mock.module('./staging', () => ({
  listStagedObjects: async (peerId: string) => stagedByPeer[peerId] ?? [],
}));

const { listPeers } = await import('./pairing');

afterAll(() => {
  mock.module('@/lib/db', () => realDb);
  mock.module('./staging', () => realStaging);
});

function peer(overrides: PeerFixture = {}): PeerFixture {
  return {
    id: 'peer_a',
    name: 'Friend',
    remoteBaseUrl: '',
    remotePeerId: null,
    outboundToken: null,
    inboundTokenHash: 'secret-hash',
    inboundTokenPrefix: 'lbpeer_abc…',
    quotaBytes: 1000,
    usedBytes: 250,
    transport: 'mailbox',
    status: 'active',
    lastSeenAt: new Date(),
    lastActivityAt: null,
    remoteUsedBytes: null,
    remoteQuotaBytes: null,
    remoteLastError: null,
    remoteLastSyncAt: null,
    remoteAppVersion: null,
    remoteReportedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('listPeers enrichment (C1)', () => {
  test('reports kind, online, staging totals, and oldest pending object', async () => {
    peerRows = [
      peer({
        id: 'peer_bro',
        lastSeenAt: new Date(),
        remoteUsedBytes: 512,
        remoteQuotaBytes: 4096,
        remoteLastError: 'Pull backups/a.age: Quota exceeded',
        remoteLastSyncAt: new Date('2026-01-01T00:00:00Z'),
        remoteAppVersion: '0.2.7',
        remoteReportedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ];
    stagedByPeer = {
      peer_bro: [
        { key: 'backups/a.age', size: 100, mtime: '2026-01-03T10:00:00.000Z' },
        { key: 'backups/b.age', size: 50, mtime: '2026-01-03T09:00:00.000Z' },
      ],
    };
    historyRows = [
      {
        mailboxPending: true,
        artifactPath: 'peer://peer_bro/backups/c.age',
        totalSize: 25,
        transferredSize: null,
        startTime: new Date('2026-01-03T08:00:00.000Z'),
      },
      {
        // Staged object already counted — must not double-count.
        mailboxPending: true,
        artifactPath: 'peer://peer_bro/backups/a.age',
        totalSize: 100,
        transferredSize: null,
        startTime: new Date('2026-01-03T10:00:00.000Z'),
      },
      {
        mailboxPending: true,
        artifactPath: 'peer://other_peer/backups/x.age',
        totalSize: 999,
        transferredSize: null,
        startTime: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const [listed] = await listPeers();
    expect(listed.kind).toBe('lazybro');
    expect(listed.online).toBe(true);
    expect(listed.pendingSyncCount).toBe(3);
    expect(listed.pendingBytes).toBe(175);
    expect(listed.oldestPendingAt).toBe('2026-01-03T08:00:00.000Z');
    expect(listed.usedBytes).toBe(250);
    expect(listed.remoteUsedBytes).toBe(512);
    expect(listed.remoteQuotaBytes).toBe(4096);
    expect(listed.remoteLastError).toContain('Quota exceeded');
    expect(listed.remoteLastSyncAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(listed.remoteAppVersion).toBe('0.2.7');
    expect(listed.remoteReportedAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(listed).not.toHaveProperty('outboundToken');
    expect(listed).not.toHaveProperty('inboundTokenHash');
  });

  test('a full LazyBackup peer is lazybackup and offline after 90 s', async () => {
    peerRows = [
      peer({
        id: 'peer_lb',
        remoteBaseUrl: 'https://friend.example',
        lastSeenAt: new Date(Date.now() - 120_000),
      }),
    ];
    stagedByPeer = {};
    historyRows = [];

    const [listed] = await listPeers();
    expect(listed.kind).toBe('lazybackup');
    expect(listed.online).toBe(false);
    expect(listed.pendingSyncCount).toBe(0);
    expect(listed.pendingBytes).toBe(0);
    expect(listed.oldestPendingAt).toBeNull();
    expect(listed.remoteUsedBytes).toBeNull();
  });
});
