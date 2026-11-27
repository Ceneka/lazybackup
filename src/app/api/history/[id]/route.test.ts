import { beforeEach, describe, expect, mock, test , afterAll} from 'bun:test';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
      },
    },
  },
}));

const { buildRestoreSnapshot } = await import('@/lib/backup/restore-snapshot');
const { GET } = await import('@/app/api/history/[id]/route');

function request(id: string) {
  return new NextRequest(`http://127.0.0.1/api/history/${id}`);
}

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

beforeEach(() => {
  historyFixture = null;
});

describe('GET /api/history/[id] restoreDefaults (contract C5)', () => {
  test('returns run defaults and flags a config edited after the run', async () => {
    const snapshot = buildRestoreSnapshot({
      sourceKind: 'server',
      serverId: 'srv-1',
      sourceType: 'path',
      sourcePath: '/srv/app',
      destinationKind: 'local',
      destinationPath: '/backups/app',
    });
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/backups/app/2026-08-07_23-15-01',
      artifactRemoved: false,
      configSnapshot: JSON.stringify(snapshot),
      backupConfig: {
        id: 'cfg-1',
        name: 'App',
        sourceKind: 'server',
        serverId: 'srv-1',
        sourceType: 'path',
        sourcePath: '/srv/app-v2',
        destinationKind: 'local',
        destinationPath: '/backups/app',
      },
    };

    const response = await GET(request('h1'), {
      params: Promise.resolve({ id: 'h1' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      restoreDefaults: Record<string, unknown> | null;
    };

    expect(body.restoreDefaults).toEqual({
      targetPath: '/srv/app',
      targetServerId: 'srv-1',
      databaseName: null,
      volumeName: null,
      configChangedSinceRun: true,
    });
  });

  test('returns null for legacy rows without a snapshot', async () => {
    historyFixture = {
      id: 'h-legacy',
      status: 'success',
      artifactPath: '/backups/app',
      backupConfig: {
        id: 'cfg-1',
        name: 'App',
        sourceType: 'path',
        sourcePath: '/srv/app',
        destinationKind: 'local',
        destinationPath: '/backups/app',
      },
    };

    const response = await GET(request('h-legacy'), {
      params: Promise.resolve({ id: 'h-legacy' }),
    });
    const body = (await response.json()) as { restoreDefaults: unknown };
    expect(body.restoreDefaults).toBeNull();
  });
});
