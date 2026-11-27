import { describe, expect, mock, test , afterAll} from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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
    },
  },
}));

const { restorePathBackup, restoreDatabaseBackup } = await import('@/lib/backup');

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('local path restore target validation', () => {
  test('refuses to restore onto a system pseudo-filesystem path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-restore-target-'));
    const artifact = path.join(dir, 'artifact');
    await fs.mkdir(artifact);
    await fs.writeFile(path.join(artifact, 'file.txt'), 'payload');
    try {
      historyFixture = {
        id: 'h-target',
        status: 'success',
        artifactPath: artifact,
        backupConfig: {
          sourceType: 'path',
          sourceKind: 'local',
          sourcePath: path.join(dir, 'source'),
          destinationKind: 'local',
        },
      };

      await expect(
        restorePathBackup('h-target', {
          confirm: true,
          allowRetarget: true,
          targetPath: '/proc/lbtest-restedge-target',
        })
      ).rejects.toThrow(/refus|unsafe|not allowed/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses to restore a SQLite dump onto the instance data directory', async () => {
    const prevDb = process.env.DATABASE_URL;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-restore-sqlite-'));
    const artifact = path.join(dir, 'app.sqlite.gz');
    const instanceDb = path.join(dir, 'instance', 'data.db');
    try {
      await fs.writeFile(artifact, 'not really gzip');
      process.env.DATABASE_URL = `file:${instanceDb}`;
      historyFixture = {
        id: 'h-sqlite-target',
        status: 'success',
        artifactPath: artifact,
        backupConfig: {
          sourceType: 'database',
          sourceKind: 'local',
          sourcePath: path.join(dir, 'source.db'),
          dbEngine: 'sqlite',
          dbClient: 'native',
          destinationKind: 'local',
        },
      };

      await expect(
        restoreDatabaseBackup('h-sqlite-target', {
          confirm: true,
          allowRetarget: true,
          databaseName: instanceDb,
        })
      ).rejects.toThrow(/Refusing to restore/);
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
