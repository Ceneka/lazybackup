import { describe, expect, test } from 'bun:test';
import { backupConfigSchema } from './schema';

describe('backupConfigSchema', () => {
  const base = {
    sourceKind: 'server' as const,
    serverId: 'srv1',
    destinationKind: 'local' as const,
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
    expect(parsed.sourceKind).toBe('server');
    expect(parsed.destinationKind).toBe('local');
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

  test('rejects docker volume without source server', () => {
    const result = backupConfigSchema.safeParse({
      ...base,
      sourceKind: 'local',
      serverId: null,
      sourceType: 'docker_volume',
      sourcePath: 'app_data',
    });
    expect(result.success).toBe(false);
  });

  test('requires destination server when destinationKind is server', () => {
    const result = backupConfigSchema.safeParse({
      ...base,
      destinationKind: 'server',
      destinationServerId: '',
      sourcePath: '/data',
    });
    expect(result.success).toBe(false);
  });

  test('accepts server to server', () => {
    const parsed = backupConfigSchema.parse({
      ...base,
      destinationKind: 'server',
      destinationServerId: 'srv2',
      sourcePath: '/data',
      destinationPath: '/backups/data',
    });
    expect(parsed.destinationServerId).toBe('srv2');
    expect(parsed.serverId).toBe('srv1');
  });

  test('clears server ids for local endpoints', () => {
    const parsed = backupConfigSchema.parse({
      sourceKind: 'local',
      serverId: 'ignored',
      destinationKind: 'local',
      destinationServerId: 'ignored',
      name: 'Local copy',
      sourcePath: '/tmp/a',
      destinationPath: '/tmp/b',
      schedule: '0 0 * * *',
    });
    expect(parsed.serverId).toBeNull();
    expect(parsed.destinationServerId).toBeNull();
  });

  test('rejects same path on same endpoint', () => {
    const result = backupConfigSchema.safeParse({
      sourceKind: 'local',
      destinationKind: 'local',
      name: 'Nope',
      sourcePath: '/tmp/same',
      destinationPath: '/tmp/same',
      schedule: '0 0 * * *',
    });
    expect(result.success).toBe(false);
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
