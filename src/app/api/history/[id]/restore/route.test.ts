import { describe, expect, mock, test } from 'bun:test';
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
      },
      peerDeletes: { findFirst: async () => null },
      servers: { findFirst: async () => null },
      peerRecalls: { findFirst: async () => null },
    },
  },
}));

const { POST } = await import('@/app/api/history/[id]/restore/route');

function request(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1/api/history/${id}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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
