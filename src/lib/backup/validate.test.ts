import { describe, expect, test } from 'bun:test';
import type { BackupConfigWithEndpoints } from './index';
import {
  attachLastValidation,
  formatLastValidation,
  validateBackupConfig,
} from './validate';

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

describe('formatLastValidation', () => {
  test('returns null when never validated', () => {
    expect(formatLastValidation({})).toBeNull();
    expect(formatLastValidation({ lastValidatedAt: null })).toBeNull();
  });

  test('parses stored checks JSON', () => {
    const at = new Date('2026-08-11T12:00:00.000Z');
    const result = formatLastValidation({
      lastValidatedAt: at,
      lastValidationOk: true,
      lastValidationChecks: JSON.stringify([
        { id: 'schedule', label: 'Cron schedule', status: 'pass', message: 'ok' },
      ]),
    });
    expect(result).toEqual({
      ok: true,
      at: at.toISOString(),
      checks: [
        { id: 'schedule', label: 'Cron schedule', status: 'pass', message: 'ok' },
      ],
    });
  });

  test('attachLastValidation replaces raw columns', () => {
    const at = new Date('2026-08-11T12:00:00.000Z');
    const shaped = attachLastValidation({
      id: 'cfg',
      lastValidatedAt: at,
      lastValidationOk: false,
      lastValidationChecks: '[]',
    });
    expect(shaped.lastValidation).toEqual({ ok: false, at: at.toISOString(), checks: [] });
    expect('lastValidatedAt' in shaped).toBe(false);
    expect('lastValidationOk' in shaped).toBe(false);
    expect('lastValidationChecks' in shaped).toBe(false);
  });
});

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
