import { describe, expect, test } from 'bun:test';
import type { BackupConfigWithEndpoints } from './index';
import { validateBackupConfig } from './validate';

process.env.NEXT_RUNTIME = 'nodejs';

function baseConfig(
  overrides: Partial<BackupConfigWithEndpoints> & {
    sourcePath: string;
    destinationPath: string;
  }
): BackupConfigWithEndpoints {
  return {
    id: 'cfg-validate',
    name: 'Validate me',
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

describe('validateBackupConfig', () => {
  test('passes for local→local with existing source path', async () => {
    const result = await validateBackupConfig(
      baseConfig({
        sourcePath: process.cwd(),
        destinationPath: `/tmp/lazybackup-validate-${Date.now()}`,
      })
    );
    expect(result.ok).toBe(true);
    expect(result.checks.some((c) => c.id === 'source-path' && c.status === 'pass')).toBe(
      true
    );
    expect(result.checks.some((c) => c.id === 'dest-local' && c.status === 'pass')).toBe(
      true
    );
    expect(result.checks.some((c) => c.id === 'schedule' && c.status === 'pass')).toBe(true);
  });

  test('fails when source server is missing', async () => {
    const result = await validateBackupConfig(
      baseConfig({
        sourceKind: 'server',
        server: null,
        sourcePath: '/data',
        destinationPath: `/tmp/lazybackup-validate-${Date.now()}`,
      })
    );
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.id === 'config-source' && c.status === 'fail')
    ).toBe(true);
  });

  test('fails for S3 source with database sourceType', async () => {
    const result = await validateBackupConfig(
      baseConfig({
        sourceKind: 's3',
        sourceType: 'database',
        sourcePath: 'prefix/',
        destinationPath: `/tmp/lazybackup-validate-${Date.now()}`,
        sourceS3Profile: {
          id: 's3',
          name: 'x',
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
          bucket: 'b',
          accessKeyId: 'a',
          secretAccessKey: 's',
          forcePathStyle: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.id === 'config-source-type' && c.status === 'fail')
    ).toBe(true);
  });

  test('fails on invalid cron', async () => {
    const result = await validateBackupConfig(
      baseConfig({
        sourcePath: process.cwd(),
        destinationPath: `/tmp/lazybackup-validate-${Date.now()}`,
        schedule: 'not a cron',
      })
    );
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.id === 'schedule' && c.status === 'fail')).toBe(
      true
    );
  });
});
