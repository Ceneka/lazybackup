import { describe, expect, mock, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

process.env.NEXT_RUNTIME = 'nodejs';

type HistoryRow = {
  id: string;
  status: string;
  artifactPath: string | null;
  backupConfig: Record<string, unknown> | null;
};

let historyFixture: HistoryRow | null = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
      },
    },
  },
}));

const { resolveLocalRestoreArtifact, restoreDockerVolumeBackup, restoreDatabaseBackup } =
  await import('./index');

describe('resolveLocalRestoreArtifact', () => {
  test('returns local path when file exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-restore-'));
    const file = path.join(dir, 'vol.tar.gz');
    await fs.writeFile(file, 'data');
    try {
      const result = await resolveLocalRestoreArtifact({
        artifactPath: file,
        destinationKind: 'local',
      });
      expect(result.localPath).toBe(file);
      expect(result.tempDir).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('throws when local artifact is missing', async () => {
    await expect(
      resolveLocalRestoreArtifact({
        artifactPath: '/tmp/lazybackup-does-not-exist-xyz.tar.gz',
        destinationKind: 'local',
      })
    ).rejects.toThrow(/not found on disk/i);
  });

  test('rejects server destination kind', async () => {
    await expect(
      resolveLocalRestoreArtifact({
        artifactPath: '/tmp/x.tar.gz',
        destinationKind: 'server',
      })
    ).rejects.toThrow(/LazyBackup host/i);
  });
});

describe('restoreDockerVolumeBackup guards', () => {
  test('throws when history entry is missing', async () => {
    historyFixture = null;
    await expect(restoreDockerVolumeBackup('missing')).rejects.toThrow(
      /history entry not found/i
    );
  });

  test('throws when status is not success', async () => {
    historyFixture = {
      id: 'h1',
      status: 'failed',
      artifactPath: '/tmp/x.tar.gz',
      backupConfig: {
        sourceType: 'docker_volume',
        sourcePath: 'vol',
        destinationKind: 'local',
        server: { id: 's1', host: 'h', port: 22, username: 'u' },
      },
    };
    await expect(restoreDockerVolumeBackup('h1')).rejects.toThrow(
      /Only successful backups/i
    );
  });

  test('throws when sourceType is not docker_volume', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x.tar.gz',
      backupConfig: {
        sourceType: 'path',
        sourcePath: '/data',
        destinationKind: 'local',
        server: { id: 's1', host: 'h', port: 22, username: 'u' },
      },
    };
    await expect(restoreDockerVolumeBackup('h1')).rejects.toThrow(
      /Docker volume backups/i
    );
  });

  test('throws when artifactPath is missing', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: null,
      backupConfig: {
        sourceType: 'docker_volume',
        sourcePath: 'vol',
        destinationKind: 'local',
        server: { id: 's1', host: 'h', port: 22, username: 'u' },
      },
    };
    await expect(restoreDockerVolumeBackup('h1')).rejects.toThrow(
      /no stored artifact path/i
    );
  });
});

describe('restoreDatabaseBackup guards', () => {
  test('throws when history entry is missing', async () => {
    historyFixture = null;
    await expect(restoreDatabaseBackup('missing')).rejects.toThrow(
      /history entry not found/i
    );
  });

  test('throws when sourceType is not database', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x.sql.gz',
      backupConfig: {
        sourceType: 'docker_volume',
        sourcePath: 'vol',
        destinationKind: 'local',
        server: null,
      },
    };
    await expect(restoreDatabaseBackup('h1')).rejects.toThrow(/database backups/i);
  });
});
