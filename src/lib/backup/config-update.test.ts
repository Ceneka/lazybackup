import { describe, expect, test } from 'bun:test';
import {
  buildBackupConfigUpdate,
  type BackupConfigRow,
} from './config-update';
import { backupConfigUpdateSchema } from './schema';

function makeExisting(overrides: Partial<BackupConfigRow> = {}): BackupConfigRow {
  return {
    id: 'cfg1',
    name: 'Test',
    sourceKind: 'server',
    serverId: 'srv1',
    sourceS3ProfileId: null,
    sourceGitRepoId: null,
    destinationKind: 'local',
    destinationServerId: null,
    destinationS3ProfileId: null,
    destinationPeerId: null,
    sourceType: 'path',
    sourcePath: '/var/www',
    destinationPath: '/backups/test',
    schedule: '0 0 * * *',
    excludePatterns: '*.log',
    preBackupCommands: 'echo before',
    dbEngine: null,
    dbClient: null,
    dbContainer: null,
    dbHost: null,
    dbPort: null,
    dbUser: null,
    dbPassword: null,
    instanceBackupPassphrase: null,
    enabled: true,
    enableEncryption: false,
    deleteExtraneous: false,
    enableVersioning: false,
    versionsToKeep: 5,
    enableFileRetention: false,
    retentionMaxAge: 30,
    retentionMaxAgeUnit: 'days',
    retentionMinKeep: 5,
    lastValidatedAt: null,
    lastValidationOk: null,
    lastValidationChecks: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function update(
  existing: BackupConfigRow,
  body: unknown
): ReturnType<typeof buildBackupConfigUpdate> {
  return buildBackupConfigUpdate(existing, backupConfigUpdateSchema.parse(body));
}

describe('buildBackupConfigUpdate omitted fields', () => {
  test('keeps stored booleans and numbers when the body omits them', () => {
    const existing = makeExisting({
      enabled: false,
      deleteExtraneous: true,
      enableVersioning: true,
      versionsToKeep: 9,
      retentionMaxAge: 90,
      retentionMinKeep: 12,
    });

    const { candidate, update: patch } = update(existing, { name: 'Renamed' });

    expect(patch.name).toBe('Renamed');
    expect(patch).not.toHaveProperty('enabled');
    expect(patch).not.toHaveProperty('deleteExtraneous');
    expect(patch).not.toHaveProperty('enableVersioning');
    expect(patch).not.toHaveProperty('versionsToKeep');
    expect(patch).not.toHaveProperty('retentionMaxAge');
    expect(patch).not.toHaveProperty('retentionMinKeep');
    expect(candidate.enabled).toBe(false);
    expect(candidate.deleteExtraneous).toBe(true);
    expect(candidate.enableVersioning).toBe(true);
    expect(candidate.versionsToKeep).toBe(9);
  });

  test('keeps stored exclude patterns and commands when omitted', () => {
    const existing = makeExisting({
      excludePatterns: '*.log',
      preBackupCommands: 'echo before',
    });
    const { update: patch } = update(existing, { enabled: false });
    expect(patch).not.toHaveProperty('excludePatterns');
    expect(patch).not.toHaveProperty('preBackupCommands');
  });
});

describe('buildBackupConfigUpdate explicit fields', () => {
  test('null clears nullable columns', () => {
    const existing = makeExisting({
      excludePatterns: '*.log',
      preBackupCommands: 'echo before',
      versionsToKeep: 9,
      retentionMaxAge: 90,
      retentionMaxAgeUnit: 'months',
      retentionMinKeep: 12,
    });

    const { update: patch } = update(existing, {
      excludePatterns: null,
      preBackupCommands: null,
      versionsToKeep: null,
      retentionMaxAge: null,
      retentionMaxAgeUnit: null,
      retentionMinKeep: null,
    });

    expect(patch.excludePatterns).toBeNull();
    expect(patch.preBackupCommands).toBeNull();
    expect(patch.versionsToKeep).toBeNull();
    expect(patch.retentionMaxAge).toBeNull();
    expect(patch.retentionMaxAgeUnit).toBeNull();
    expect(patch.retentionMinKeep).toBeNull();
  });

  test('null resets NOT NULL booleans to their documented defaults', () => {
    const existing = makeExisting({
      enabled: false,
      deleteExtraneous: true,
      enableVersioning: true,
    });

    const { update: patch } = update(existing, {
      enabled: null,
      deleteExtraneous: null,
      enableVersioning: null,
    });

    expect(patch.enabled).toBe(true);
    expect(patch.deleteExtraneous).toBe(false);
    expect(patch.enableVersioning).toBe(false);
  });

  test('values are written', () => {
    const existing = makeExisting({ enabled: true });

    const { update: patch } = update(existing, {
      enabled: false,
      versionsToKeep: 12,
      preBackupCommands: 'echo next',
      excludePatterns: 'node_modules',
      retentionMaxAgeUnit: 'months',
    });

    expect(patch.enabled).toBe(false);
    expect(patch.versionsToKeep).toBe(12);
    expect(patch.preBackupCommands).toBe('echo next');
    expect(patch.excludePatterns).toBe('node_modules');
    expect(patch.retentionMaxAgeUnit).toBe('months');
  });

  test('rejects an invalid cron only when schedule is part of the update', () => {
    const existing = makeExisting();
    expect(() => update(existing, { schedule: '99 * * * *' })).toThrow();
    expect(() => update(existing, { name: 'No schedule change' })).not.toThrow();
  });
});

describe('buildBackupConfigUpdate type changes', () => {
  const databaseExisting = makeExisting({
    sourceKind: 'local',
    serverId: null,
    sourceType: 'database',
    sourcePath: 'appdb',
    dbEngine: 'postgres',
    dbClient: 'native',
    dbHost: '127.0.0.1',
    dbPort: 5432,
    dbUser: 'app',
    dbPassword: 'db-secret',
  });

  test('keeps the stored database password on a same-type update', () => {
    const { update: patch } = update(databaseExisting, { name: 'Renamed' });
    expect(patch.dbPassword).toBe('db-secret');
    expect(patch.instanceBackupPassphrase).toBeNull();
  });

  test('keeps the stored password when the field is blank', () => {
    const { update: patch } = update(databaseExisting, { dbPassword: '   ' });
    expect(patch.dbPassword).toBe('db-secret');
  });

  test('clears the database password and db fields when leaving database', () => {
    const { update: patch } = update(databaseExisting, {
      sourceType: 'path',
      sourceKind: 'local',
      sourcePath: '/var/www',
    });

    expect(patch.sourceType).toBe('path');
    expect(patch.dbEngine).toBeNull();
    expect(patch.dbClient).toBeNull();
    expect(patch.dbContainer).toBeNull();
    expect(patch.dbHost).toBeNull();
    expect(patch.dbPort).toBeNull();
    expect(patch.dbUser).toBeNull();
    expect(patch.dbPassword).toBeNull();
  });

  test('clears an instance passphrase when leaving instance', () => {
    const existing = makeExisting({
      sourceKind: 'local',
      serverId: null,
      sourceType: 'lazybackup_instance',
      sourcePath: 'lazybackup-instance',
      instanceBackupPassphrase: 'passphrase-123',
    });

    const { update: patch } = update(existing, {
      sourceType: 'path',
      sourcePath: '/var/www',
    });

    expect(patch.instanceBackupPassphrase).toBeNull();
  });

  test('keeps an instance passphrase when omitted on a same-type update', () => {
    const existing = makeExisting({
      sourceKind: 'local',
      serverId: null,
      sourceType: 'lazybackup_instance',
      sourcePath: 'lazybackup-instance',
      instanceBackupPassphrase: 'passphrase-123',
    });

    const { update: patch } = update(existing, { name: 'Renamed' });
    expect(patch.instanceBackupPassphrase).toBe('passphrase-123');
  });

  test('clears a dangling peer id when the destination kind changes', () => {
    const existing = makeExisting({
      destinationKind: 'peer',
      destinationPeerId: 'peer1',
      enableEncryption: true,
    });

    const { update: patch } = update(existing, { destinationKind: 'local' });
    expect(patch.destinationKind).toBe('local');
    expect(patch.destinationPeerId).toBeNull();
  });

  test('clears stale ids when the source kind changes', () => {
    const { update: patch } = update(makeExisting(), { sourceKind: 'local' });
    expect(patch.sourceKind).toBe('local');
    expect(patch.serverId).toBeNull();
    expect(patch.sourceS3ProfileId).toBeNull();
    expect(patch.sourceGitRepoId).toBeNull();
  });
});
