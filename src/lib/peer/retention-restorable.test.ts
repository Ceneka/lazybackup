import { beforeEach, describe, expect, mock, test , afterAll} from 'bun:test';

let historyRow: { artifactRemoved: boolean | null } | null = null;
let ackedDelete: { status: string } | null = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyRow,
      },
      peerDeletes: {
        findFirst: async () => ackedDelete,
      },
    },
  },
}));

const { assertPeerArtifactRestorable } = await import('./retention');

const ARTIFACT = 'peer://peer_a/backups/config/app.tar.gz.age';

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('assertPeerArtifactRestorable', () => {
  beforeEach(() => {
    historyRow = null;
    ackedDelete = null;
  });

  test('allows a newer history row that reuses a key deleted previously', async () => {
    // Run 1 was deleted by retention (acked), then a later backup landed the
    // same object key again. The new row was never removed, so it is restorable.
    historyRow = { artifactRemoved: false };
    ackedDelete = { status: 'acked' };

    await expect(
      assertPeerArtifactRestorable(ARTIFACT, 'history_run_2')
    ).resolves.toBeUndefined();
  });

  test('still blocks a history row marked removed', async () => {
    historyRow = { artifactRemoved: true };
    ackedDelete = { status: 'acked' };

    await expect(
      assertPeerArtifactRestorable(ARTIFACT, 'history_run_1')
    ).rejects.toThrow(/retention/i);
  });

  test('falls back to the acked delete when there is no history row', async () => {
    ackedDelete = { status: 'acked' };

    await expect(assertPeerArtifactRestorable(ARTIFACT)).rejects.toThrow(
      /retention/i
    );
  });

  test('allows when no delete was ever acked', async () => {
    historyRow = { artifactRemoved: false };

    await expect(
      assertPeerArtifactRestorable(ARTIFACT, 'history_run_1')
    ).resolves.toBeUndefined();
  });
});
