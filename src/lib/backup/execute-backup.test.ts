import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

process.env.NEXT_RUNTIME = 'nodejs';

const updateSuccess = mock(
  async (_historyId: string, _stats: Record<string, unknown>) => ({ id: _historyId })
);
const updateFailure = mock(
  async (
    _historyId: string,
    _error: unknown,
    _options?: { logOutput?: string; configId?: string; backupName?: string }
  ) => ({ id: _historyId })
);

mock.module('@/lib/backup/history', () => ({
  createBackupHistoryEntry: mock(async (configId: string) => ({
    id: 'hist-created',
    configId,
    status: 'running',
  })),
  updateBackupHistorySuccess: updateSuccess,
  updateBackupHistoryFailure: updateFailure,
}));

mock.module('./history', () => ({
  createBackupHistoryEntry: mock(async (configId: string) => ({
    id: 'hist-created',
    configId,
    status: 'running',
  })),
  updateBackupHistorySuccess: updateSuccess,
  updateBackupHistoryFailure: updateFailure,
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
  const prevStorage = process.env.BACKUP_STORAGE_PATH;
  const prevAllow = process.env.ALLOW_ARBITRARY_LOCAL_PATHS;

  beforeEach(async () => {
    updateSuccess.mockClear();
    updateFailure.mockClear();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-exec-'));
    process.env.BACKUP_STORAGE_PATH = tmpRoot;
    delete process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    if (prevStorage === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prevStorage;
    if (prevAllow === undefined) delete process.env.ALLOW_ARBITRARY_LOCAL_PATHS;
    else process.env.ALLOW_ARBITRARY_LOCAL_PATHS = prevAllow;
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

  test('a failed versioned run removes the version folder it allocated', async () => {
    const destRoot = path.join(tmpRoot, 'versioned-dest');
    const config = baseLocalConfig({
      sourcePath: path.join(tmpRoot, 'does-not-exist'),
      destinationPath: destRoot,
      enableVersioning: true,
      versionsToKeep: 3,
    });

    await expect(executeBackup(config, 'hist-version-fail')).rejects.toThrow();

    // An empty version folder would otherwise consume a retention slot on
    // every failed run and eventually evict good older backups.
    expect(await fs.readdir(destRoot).catch(() => [])).toEqual([]);
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

  test('rejects local destination outside BACKUP_STORAGE_PATH', async () => {
    const config = baseLocalConfig({
      sourcePath: path.join(tmpRoot, 'src'),
      destinationPath: '/etc/cron.d',
    });
    await expect(executeBackup(config, 'hist-path')).rejects.toThrow(/BACKUP_STORAGE_PATH/);
    expect(updateFailure).toHaveBeenCalled();
  });

  test('peer destination fails fast when the peer is revoked', async () => {
    const config = baseLocalConfig({
      sourcePath: path.join(tmpRoot, 'src'),
      destinationPath: 'prefix',
      destinationKind: 'peer',
      destinationPeer: {
        id: 'peer-1',
        name: 'bro',
        status: 'revoked',
        transport: 'mailbox',
        remoteBaseUrl: '',
        quotaBytes: 1024,
        usedBytes: 0,
      } as never,
    });

    await expect(executeBackup(config, 'hist-revoked')).rejects.toThrow(
      /revoked; re-pair/i
    );
    expect(updateFailure).toHaveBeenCalled();
    expect(updateSuccess).not.toHaveBeenCalled();
  });

  test('instance meta-backup to S3 without passphrase fails closed', async () => {
    const config = baseLocalConfig({
      sourcePath: 'instance',
      destinationPath: 'prefix',
      sourceType: 'lazybackup_instance',
      destinationKind: 's3',
      destinationS3Profile: {
        id: 's3-1',
        name: 'minio',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'backups',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        forcePathStyle: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await expect(executeBackup(config, 'hist-inst')).rejects.toThrow(/passphrase/i);
    expect(updateFailure).toHaveBeenCalled();
  });

  test('a failing pre-backup command aborts before transfer and keeps the command log', async () => {
    const sourceDir = path.join(tmpRoot, 'prefail-src');
    const destRoot = path.join(tmpRoot, 'prefail-dest');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'hello.txt'), 'hello world');

    const config = baseLocalConfig({
      sourcePath: sourceDir,
      destinationPath: destRoot,
      enableVersioning: true,
      versionsToKeep: 3,
      preBackupCommands: 'exit 1',
    });

    await expect(executeBackup(config, 'hist-prefail')).rejects.toThrow(/exit 1|Pre-backup/i);

    expect(updateFailure).toHaveBeenCalledTimes(1);
    expect(updateSuccess).not.toHaveBeenCalled();

    const failureOptions = updateFailure.mock.calls[0][2];
    expect(failureOptions?.logOutput).toContain('exit code: 1');
    expect(failureOptions?.logOutput).toContain('========== Pre-Backup Commands ==========');

    // No version folder (nor copied source files) is created before the abort.
    expect(await fs.readdir(destRoot).catch(() => [])).toEqual([]);
  });

  test('pre-backup commands after a failure still run for cleanup', async () => {
    const marker = path.join(tmpRoot, 'ran.txt');
    const destRoot = path.join(tmpRoot, 'marker-dest');

    const config = baseLocalConfig({
      sourcePath: path.join(tmpRoot, 'marker-src'),
      destinationPath: destRoot,
      preBackupCommands: `exit 1\ntouch ${marker}`,
    });

    await expect(executeBackup(config, 'hist-prefail-cleanup')).rejects.toThrow(/Pre-backup/i);

    expect(await fs.stat(marker).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.readdir(destRoot).catch(() => [])).toEqual([]);
  });

  test('successful pre-backup commands keep the run successful and log them', async () => {
    const sourceDir = path.join(tmpRoot, 'preok-src');
    const destDir = path.join(tmpRoot, 'preok-dest');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'hello.txt'), 'hello world');

    const config = baseLocalConfig({
      sourcePath: sourceDir,
      destinationPath: destDir,
      preBackupCommands: 'true',
    });

    await executeBackup(config, 'hist-preok');

    expect(updateSuccess).toHaveBeenCalledTimes(1);
    expect(updateFailure).not.toHaveBeenCalled();

    const successStats = updateSuccess.mock.calls[0][1] as { logOutput?: string };
    expect(successStats.logOutput).toContain('Pre-Backup Commands');
    expect(successStats.logOutput).toContain('exit code: 0');
  });
});
