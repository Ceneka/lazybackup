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

  test('accepts database dump on local source', () => {
    const parsed = backupConfigSchema.parse({
      sourceKind: 'local',
      destinationKind: 'local',
      name: 'DB dump',
      sourceType: 'database',
      sourcePath: 'appdb',
      destinationPath: '/backups/db',
      schedule: '0 0 * * *',
      dbEngine: 'postgres',
      dbClient: 'native',
      dbUser: 'app',
      dbPassword: 'secret',
      dbHost: '127.0.0.1',
    });
    expect(parsed.sourceType).toBe('database');
    expect(parsed.dbEngine).toBe('postgres');
    expect(parsed.dbHost).toBe('127.0.0.1');
    expect(parsed.serverId).toBeNull();
  });

  test('requires container for docker database client', () => {
    const result = backupConfigSchema.safeParse({
      ...base,
      sourceType: 'database',
      sourcePath: 'appdb',
      dbEngine: 'mysql',
      dbClient: 'docker',
      dbUser: 'root',
    });
    expect(result.success).toBe(false);
  });

  test('accepts docker database client with container', () => {
    const parsed = backupConfigSchema.parse({
      ...base,
      sourceType: 'database',
      sourcePath: 'appdb',
      dbEngine: 'postgres',
      dbClient: 'docker',
      dbContainer: 'postgres',
      dbUser: 'postgres',
      dbPassword: '',
    });
    expect(parsed.dbContainer).toBe('postgres');
    expect(parsed.dbPassword).toBe('');
  });

  test('clears db fields when sourceType is path', () => {
    const parsed = backupConfigSchema.parse({
      ...base,
      sourcePath: '/data',
      sourceType: 'path',
      dbEngine: 'postgres',
      dbClient: 'native',
      dbUser: 'x',
    });
    expect(parsed.dbEngine).toBeNull();
    expect(parsed.dbUser).toBeNull();
  });

  test('allows database name equal to destination path string', () => {
    const parsed = backupConfigSchema.parse({
      sourceKind: 'local',
      destinationKind: 'local',
      name: 'OK',
      sourceType: 'database',
      sourcePath: 'same',
      destinationPath: 'same',
      schedule: '0 0 * * *',
      dbEngine: 'postgres',
      dbClient: 'native',
      dbUser: 'u',
    });
    expect(parsed.sourcePath).toBe('same');
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
