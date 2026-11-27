import { afterAll, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

process.env.NEXT_RUNTIME = 'nodejs';

// Bun module mocks are process-wide; clear any mock left by an earlier test file.
mock.restore();

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;
let captured: Record<string, unknown> | null = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
        findMany: async () => [],
      },
      servers: { findFirst: async () => null },
      s3Profiles: { findFirst: async () => null },
      peers: { findFirst: async () => null },
    },
  },
}));

mock.module('@/lib/backup', () => ({
  resolveLocalRestoreArtifact: async (options: Record<string, unknown>) => {
    captured = options;
    return { localPath: options.artifactPath as string, tempDir: null };
  },
  loadRestoreEndpointRows: async () => ({
    destinationServer: null,
    destinationS3Profile: null,
    destinationPeer: null,
    sourceServer: null,
    sourceS3Profile: null,
  }),
}));

const { buildRestoreSnapshot } = await import('@/lib/backup/restore-snapshot');
const { GET } = await import('@/app/api/history/[id]/download/route');

function request(id: string): NextRequest {
  return new NextRequest(`http://127.0.0.1/api/history/${id}/download`);
}

afterAll(async () => {
  mock.restore();
  // mock.restore() does not put module mocks back; later files import the real
  // backup and db modules, so restore full copies explicitly.
  const freshBackup = await import(
    `../../../../../lib/backup/index.ts?real=${Date.now()}`
  );
  mock.module('@/lib/backup', () => freshBackup);
  const freshDb = await import(`../../../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('GET /api/history/[id]/download', () => {
  test('resolves the artifact through the run snapshot, not the edited config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-download-snapshot-'));
    const artifact = path.join(dir, 'app.tar.gz');
    await fs.writeFile(artifact, 'artifact-bytes');
    try {
      const snapshot = buildRestoreSnapshot({
        sourceKind: 'local',
        sourceType: 'path',
        sourcePath: '/srv/app',
        destinationKind: 'local',
        destinationPath: '/backups/local',
      });
      historyFixture = {
        id: 'h-download',
        status: 'success',
        artifactPath: artifact,
        artifactSha256: null,
        artifactRemoved: false,
        configSnapshot: JSON.stringify(snapshot),
        backupConfig: {
          // The live config was edited to a friend after the run.
          destinationKind: 'peer',
          destinationPeerId: 'p1',
          destinationPeer: { id: 'p1', name: 'Friend' },
          destinationS3ProfileId: null,
          destinationS3Profile: null,
          destinationServerId: null,
          destinationServer: null,
          serverId: null,
          server: null,
          sourceS3ProfileId: null,
          sourceS3Profile: null,
          sourceKind: 'server',
          sourceType: 'path',
          sourcePath: '/srv/app',
          destinationPath: '/backups/local',
        },
      };
      captured = null;

      const res = await GET(request('h-download'), {
        params: Promise.resolve({ id: 'h-download' }),
      });
      await res.arrayBuffer();

      expect(res.status).toBe(200);
      expect(captured?.destinationKind).toBe('local');
      expect(captured?.destinationPeer).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
