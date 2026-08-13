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

const {
  resolveLocalRestoreArtifact,
  resolveLocalPathRestoreTree,
  looksLikePathArchiveName,
  restoreDockerVolumeBackup,
  restoreDatabaseBackup,
  restorePathBackup,
} = await import('./index');

describe('looksLikePathArchiveName', () => {
  test('detects packed archives', () => {
    expect(looksLikePathArchiveName('backup.tar.gz')).toBe(true);
    expect(looksLikePathArchiveName('backup.tar.gz.age')).toBe(true);
    expect(looksLikePathArchiveName('prefix/dir/')).toBe(false);
    expect(looksLikePathArchiveName('app.sql.gz')).toBe(false);
  });
});

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

  test('rejects when expected sha256 does not match the file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-restore-'));
    const file = path.join(dir, 'vol.tar.gz.age');
    await fs.writeFile(file, 'ciphertext');
    try {
      await expect(
        resolveLocalRestoreArtifact({
          artifactPath: file,
          destinationKind: 'local',
          expectedSha256: '0'.repeat(64),
          decrypt: false,
        })
      ).rejects.toThrow(/SHA-256 mismatch/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects server destination kind', async () => {
    await expect(
      resolveLocalRestoreArtifact({
        artifactPath: '/tmp/x.tar.gz',
        destinationKind: 'server',
      })
    ).rejects.toThrow(/LazyBackup host/i);
  });

  test('local file still resolves when waitForPeerRecall is false', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-restore-'));
    const file = path.join(dir, 'dump.sql.gz');
    await fs.writeFile(file, 'sql');
    try {
      const result = await resolveLocalRestoreArtifact({
        artifactPath: file,
        destinationKind: 'local',
        decrypt: false,
        waitForPeerRecall: false,
      });
      expect(result.localPath).toBe(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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

  test('requires confirm=true before restoring', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x.tar.gz',
      backupConfig: {
        sourceType: 'docker_volume',
        sourcePath: 'vol',
        destinationKind: 'local',
        server: { id: 's1', host: 'h', port: 22, username: 'u' },
      },
    };
    await expect(restoreDockerVolumeBackup('h1', { volumeName: 'vol' })).rejects.toThrow(
      /confirm=true/i
    );
  });

  test('requires allowRetarget to change volume', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x.tar.gz',
      backupConfig: {
        sourceType: 'docker_volume',
        sourcePath: 'vol',
        destinationKind: 'local',
        server: { id: 's1', host: 'h', port: 22, username: 'u' },
      },
    };
    await expect(
      restoreDockerVolumeBackup('h1', { confirm: true, volumeName: 'other' })
    ).rejects.toThrow(/allowRetarget/i);
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

describe('resolveLocalPathRestoreTree', () => {
  test('returns directory artifact as tree', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-path-tree-'));
    await fs.writeFile(path.join(dir, 'hello.txt'), 'hi');
    try {
      const result = await resolveLocalPathRestoreTree({
        artifactPath: dir,
        destinationKind: 'local',
      });
      expect(result.treePath).toBe(dir);
      expect(result.tempDir).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('extracts local tar.gz into a tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-path-tar-'));
    const src = path.join(root, 'app');
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, 'a.txt'), 'a');
    const archive = path.join(root, 'app.tar.gz');
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    await promisify(execFile)('tar', ['-czf', archive, '-C', root, 'app']);
    try {
      const result = await resolveLocalPathRestoreTree({
        artifactPath: archive,
        destinationKind: 'local',
      });
      expect(result.tempDir).toBeTruthy();
      const restored = await fs.readFile(path.join(result.treePath, 'a.txt'), 'utf8');
      expect(restored).toBe('a');
      if (result.tempDir) {
        await fs.rm(result.tempDir, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('restorePathBackup guards and local restore', () => {
  test('throws when history entry is missing', async () => {
    historyFixture = null;
    await expect(restorePathBackup('missing', { confirm: true })).rejects.toThrow(
      /history entry not found/i
    );
  });

  test('throws without confirm', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x',
      backupConfig: {
        sourceType: 'path',
        sourceKind: 'local',
        sourcePath: '/tmp/dest',
        destinationKind: 'local',
      },
    };
    await expect(restorePathBackup('h1')).rejects.toThrow(/confirm=true/i);
  });

  test('throws when sourceType is not path', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: '/tmp/x',
      backupConfig: {
        sourceType: 'database',
        sourcePath: 'db',
        destinationKind: 'local',
      },
    };
    await expect(restorePathBackup('h1', { confirm: true })).rejects.toThrow(
      /only for path/i
    );
  });

  test('restores local directory tree onto another local path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-path-restore-'));
    const artifact = path.join(root, 'artifact');
    const target = path.join(root, 'target');
    await fs.mkdir(artifact);
    await fs.writeFile(path.join(artifact, 'file.txt'), 'payload');
    historyFixture = {
      id: 'h-path',
      status: 'success',
      artifactPath: artifact,
      backupConfig: {
        sourceType: 'path',
        sourceKind: 'local',
        sourcePath: target,
        destinationKind: 'local',
      },
    };
    try {
      const result = await restorePathBackup('h-path', { confirm: true });
      expect(result.targetPath).toBe(target);
      const body = await fs.readFile(path.join(target, 'file.txt'), 'utf8');
      expect(body).toBe('payload');
      expect(result.log).toMatch(/Restore completed successfully/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
