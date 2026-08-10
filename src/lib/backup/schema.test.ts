import { describe, expect, test } from 'bun:test';
import { backupConfigSchema } from './schema';

describe('backupConfigSchema', () => {
  const base = {
    serverId: 'srv1',
    name: 'Test',
    destinationPath: '/backups/test',
    schedule: '0 0 * * *',
  };

  test('defaults sourceType to path', () => {
    const parsed = backupConfigSchema.parse({
      ...base,
      sourcePath: '/var/www',
    });
    expect(parsed.sourceType).toBe('path');
  });

  test('accepts valid docker volume source', () => {
    const parsed = backupConfigSchema.parse({
      ...base,
      sourceType: 'docker_volume',
      sourcePath: 'app_data',
    });
    expect(parsed.sourceType).toBe('docker_volume');
    expect(parsed.sourcePath).toBe('app_data');
  });

  test('rejects invalid docker volume names', () => {
    const result = backupConfigSchema.safeParse({
      ...base,
      sourceType: 'docker_volume',
      sourcePath: '../evil',
    });
    expect(result.success).toBe(false);
  });

  test('rejects versioning with file retention', () => {
    const result = backupConfigSchema.safeParse({
      ...base,
      sourcePath: '/data',
      enableVersioning: true,
      enableFileRetention: true,
    });
    expect(result.success).toBe(false);
  });
});
