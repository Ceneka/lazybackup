import { describe, expect, mock, test , afterAll} from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
        findMany: async () => [],
      },
      peerDeletes: { findFirst: async () => null },
      servers: { findFirst: async () => null },
      s3Profiles: { findFirst: async () => null },
      peers: { findFirst: async () => null },
      peerRecalls: { findFirst: async () => null },
    },
  },
}));

// Another test file mocks @/lib/backup; make sure the route binds real exports.
const realBackup = await import(
  `../../../../../lib/backup/index.ts?real=${Date.now()}`
);
mock.module('@/lib/backup', () => realBackup);

const { POST } = await import('@/app/api/history/[id]/restore/route');
const { beginRestore, resetRestoreLocksForTests } = await import(
  '@/lib/backup/concurrent-run'
);

function request(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1/api/history/${id}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../../../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  const freshBackup = await import(
    `../../../../../lib/backup/index.ts?real=${Date.now()}`
  );
  mock.module('@/lib/backup', () => freshBackup);
});

describe('POST /api/history/[id]/restore — sqlite targets', () => {
  test('a sqlite restore may target a filesystem path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-route-sqlite-'));
    const dbPath = path.join(dir, 'app.db');
    try {
      historyFixture = {
        id: 'h-sqlite',
        status: 'success',
        // Deliberately missing so the restore fails after validation; we only
        // care that it is not rejected as an "Invalid database name".
        artifactPath: path.join(dir, 'missing.sqlite.gz'),
        backupConfig: {
          sourceType: 'database',
          sourceKind: 'local',
          sourcePath: dbPath,
          dbEngine: 'sqlite',
          dbClient: 'native',
          destinationKind: 'local',
        },
      };

      const res = await POST(request('h-sqlite', { confirm: true, databaseName: dbPath }), {
        params: Promise.resolve({ id: 'h-sqlite' }),
      });
      const body = (await res.json()) as { error?: string };

      expect(body.error || '').not.toMatch(/Invalid database name/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('non-sqlite databases still reject non-identifier names', async () => {
    historyFixture = {
      id: 'h-pg',
      status: 'success',
      artifactPath: '/tmp/missing.sql.gz',
      backupConfig: {
        sourceType: 'database',
        sourceKind: 'server',
        sourcePath: 'app',
        dbEngine: 'postgres',
        dbClient: 'native',
        destinationKind: 'local',
      },
    };

    const res = await POST(
      request('h-pg', { confirm: true, databaseName: '/etc/passwd' }),
      { params: Promise.resolve({ id: 'h-pg' }) }
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Invalid database name/i);
  });
});

describe('POST /api/history/[id]/restore — error status codes', () => {
  test('retarget without allowRetarget is a 400, not a 500', async () => {
    historyFixture = {
      id: 'h-retarget',
      status: 'success',
      artifactPath: '/tmp/does-not-matter',
      backupConfig: {
        sourceType: 'path',
        sourceKind: 'server',
        serverId: 's1',
        sourcePath: '/srv/app',
        destinationKind: 'local',
      },
    };

    const res = await POST(
      request('h-retarget', { confirm: true, targetServerId: 's2' }),
      { params: Promise.resolve({ id: 'h-retarget' }) }
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/allowRetarget/i);
  });

  test('git restore without targetPath is a 400', async () => {
    historyFixture = {
      id: 'h-git',
      status: 'success',
      artifactPath: '/tmp/missing-git.tar.gz',
      backupConfig: {
        sourceType: 'git_repo',
        sourceKind: 'git',
        sourcePath: 'git-mirror',
        destinationKind: 'local',
      },
    };

    const res = await POST(request('h-git', { confirm: true }), {
      params: Promise.resolve({ id: 'h-git' }),
    });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/targetPath/i);
  });

  test('a concurrent restore of the same history row is a 409', async () => {
    historyFixture = {
      id: 'h-lock',
      status: 'success',
      artifactPath: '/tmp/missing.sql.gz',
      backupConfig: {
        sourceType: 'database',
        sourceKind: 'local',
        sourcePath: 'app',
        dbEngine: 'postgres',
        dbClient: 'native',
        destinationKind: 'local',
      },
    };

    const release = await beginRestore({ historyId: 'h-lock', configId: 'cfg-1' });
    try {
      const res = await POST(request('h-lock', { confirm: true }), {
        params: Promise.resolve({ id: 'h-lock' }),
      });
      const body = (await res.json()) as { error?: string };
      expect(res.status).toBe(409);
      expect(body.error).toMatch(/already running/i);
    } finally {
      release();
      resetRestoreLocksForTests();
    }
  });
});
