import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

process.env.NEXT_RUNTIME = 'nodejs';

const updateSuccess = mock(
  async (_historyId: string, _stats: Record<string, unknown>) => ({ id: _historyId })
);
const updateFailure = mock(
  async (_historyId: string, _error: unknown) => ({ id: _historyId })
);

mock.module('@/lib/backup/history', () => ({
  createBackupHistoryEntry: mock(async (configId: string) => ({
    id: 'hist-created',
    configId,
    status: 'running',
  })),
  updateBackupHistorySuccess: updateSuccess,
  updateBackupHistoryFailure: updateFailure,
  getRecentBackupHistory: mock(async () => []),
  getLatestBackup: mock(async () => null),
  getBackupSuccessRate: mock(async () => 100),
}));

mock.module('./history', () => ({
  createBackupHistoryEntry: mock(async (configId: string) => ({
    id: 'hist-created',
    configId,
    status: 'running',
  })),
  updateBackupHistorySuccess: updateSuccess,
  updateBackupHistoryFailure: updateFailure,
  getRecentBackupHistory: mock(async () => []),
  getLatestBackup: mock(async () => null),
  getBackupSuccessRate: mock(async () => 100),
}));

const { executeBackup } = await import('./index');
import type { BackupConfigWithEndpoints } from './index';

function baseLocalConfig(
  overrides: Partial<BackupConfigWithEndpoints> & {
    sourcePath: string;
    destinationPath: string;
  }
): BackupConfigWithEndpoints {
  return {
    id: 'cfg-1',
    name: 'Local path backup',
    sourceKind: 'local',
    destinationKind: 'local',
    sourceType: 'path',
    schedule: '0 0 * * *',
    enabled: true,
    enableVersioning: false,
    server: null,
    destinationServer: null,
    sourceS3Profile: null,
    destinationS3Profile: null,
    ...overrides,
  };
}

describe('executeBackup', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    updateSuccess.mockClear();
    updateFailure.mockClear();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-exec-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test('local → local path copies files and records success', async () => {
    const sourceDir = path.join(tmpRoot, 'src');
    const destDir = path.join(tmpRoot, 'dest');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'hello.txt'), 'hello world');

    const config = baseLocalConfig({
      sourcePath: sourceDir,
      destinationPath: destDir,
    });

    await executeBackup(config, 'hist-1');

    const copied = await fs.readFile(path.join(destDir, 'hello.txt'), 'utf8');
    expect(copied).toBe('hello world');
    expect(updateSuccess).toHaveBeenCalled();
    expect(updateFailure).not.toHaveBeenCalled();

    const successArgs = updateSuccess.mock.calls[0];
    expect(successArgs[0]).toBe('hist-1');
    expect(successArgs[1]).toMatchObject({ artifactPath: destDir });
  });

  test('missing source server records failure and rethrows', async () => {
    const config = baseLocalConfig({
      sourcePath: '/tmp/x',
      destinationPath: path.join(tmpRoot, 'dest'),
      sourceKind: 'server',
      server: null,
    });

    await expect(executeBackup(config, 'hist-fail')).rejects.toThrow(
      /Source server is missing/i
    );
    expect(updateFailure).toHaveBeenCalled();
    expect(updateSuccess).not.toHaveBeenCalled();
  });

  test('S3 source with non-path sourceType fails early', async () => {
    const config = baseLocalConfig({
      sourcePath: 'prefix/',
      destinationPath: path.join(tmpRoot, 'dest'),
      sourceKind: 's3',
      sourceType: 'database',
      sourceS3Profile: {
        id: 's3-1',
        name: 'minio',
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'backups',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        forcePathStyle: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await expect(executeBackup(config, 'hist-s3')).rejects.toThrow(
      /S3 sources only support path/i
    );
    expect(updateFailure).toHaveBeenCalled();
  });
});
