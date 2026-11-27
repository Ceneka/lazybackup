import { afterAll, describe, expect, mock, test } from 'bun:test';
import * as realDb from '@/lib/db';
import * as realStaging from './staging';

type FindManyArgs = {
  where?: unknown;
  columns?: Record<string, boolean>;
  with?: unknown;
};

let pendingHistory: Array<Record<string, unknown>> = [];
let findManyArgs: FindManyArgs[] = [];

const peerRow = {
  id: 'peer_slim',
  name: 'Friend',
  remoteBaseUrl: '',
  remotePeerId: null,
  outboundToken: null,
  inboundTokenHash: 'secret-hash',
  inboundTokenPrefix: 'lbpeer_abc…',
  quotaBytes: 1000,
  usedBytes: 0,
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
};

mock.module('@/lib/db', () => ({
  db: {
    query: {
      peers: { findMany: async () => [peerRow] },
      backupHistory: {
        findMany: async (args: FindManyArgs) => {
          findManyArgs.push(args);
          return pendingHistory;
        },
      },
    },
  },
}));

mock.module('./staging', () => ({
  listStagedObjects: async () => [],
}));

const { listPeers } = await import('./pairing');

afterAll(() => {
  mock.module('@/lib/db', () => realDb);
  mock.module('./staging', () => realStaging);
});

describe('GET /api/peers pending-history query', () => {
  test('selects only the slim fields the peer cards use', async () => {
    findManyArgs = [];
    pendingHistory = [
      {
        id: 'h1',
        configId: 'cfg1',
        artifactPath: 'peer://peer_slim/backups/a.age',
        totalSize: 25,
        transferredSize: null,
        startTime: new Date('2026-01-03T08:00:00.000Z'),
        mailboxPending: true,
        logOutput: 'x'.repeat(10_000),
        configSnapshot: '{"should":"not be selected"}',
      },
      {
        id: 'h2',
        configId: 'cfg1',
        artifactPath: 'peer://peer_slim/backups/b.age',
        totalSize: null,
        transferredSize: 10,
        startTime: new Date('2026-01-03T09:00:00.000Z'),
        mailboxPending: true,
      },
      {
        id: 'h3',
        configId: 'cfg2',
        artifactPath: 'peer://other_peer/backups/c.age',
        totalSize: 999,
        transferredSize: null,
        startTime: new Date('2026-01-01T00:00:00.000Z'),
        mailboxPending: true,
      },
    ];

    const [listed] = await listPeers();

    expect(findManyArgs).toHaveLength(1);
    // Slim row shape: no log_output / config_snapshot in the SELECT.
    expect(findManyArgs[0]?.columns).toEqual({
      id: true,
      configId: true,
      artifactPath: true,
      totalSize: true,
      transferredSize: true,
      startTime: true,
      mailboxPending: true,
    });
    expect(findManyArgs[0]?.columns).not.toHaveProperty('logOutput');
    expect(findManyArgs[0]?.columns).not.toHaveProperty('configSnapshot');
    expect(findManyArgs[0]?.with).toBeUndefined();

    // Behaviour is unchanged: totals still count only this peer's pending rows.
    expect(listed.pendingSyncCount).toBe(2);
    expect(listed.pendingBytes).toBe(35);
    expect(listed.oldestPendingAt).toBe('2026-01-03T08:00:00.000Z');
  });
});
