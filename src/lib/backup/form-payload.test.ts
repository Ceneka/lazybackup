import { describe, expect, test } from 'bun:test';
import { formDataToPayload, type BackupFormData } from './form-payload';

function makeFormData(overrides: Partial<BackupFormData> = {}): BackupFormData {
  return {
    name: 'Local copy',
    sourceKind: 'local',
    serverId: '',
    sourceS3ProfileId: '',
    sourceGitRepoId: '',
    destinationKind: 'local',
    destinationServerId: '',
    destinationS3ProfileId: '',
    destinationPeerId: '',
    sourceType: 'path',
    sourcePath: '/tmp/src',
    destinationPath: '/tmp/dst',
    schedule: '0 2 * * *',
    excludePatterns: '',
    preBackupCommands: '',
    dbEngine: 'postgres',
    dbClient: 'native',
    dbContainer: '',
    dbHost: '127.0.0.1',
    dbPort: '',
    dbUser: '',
    dbPassword: '',
    instanceBackupPassphrase: '',
    enabled: true,
    enableEncryption: false,
    deleteExtraneous: false,
    enableVersioning: false,
    versionsToKeep: 5,
    enableFileRetention: false,
    retentionMaxAge: 30,
    retentionMaxAgeUnit: 'days',
    retentionMinKeep: 5,
    ...overrides,
  };
}

describe('formDataToPayload preBackupCommands', () => {
  test('empty string becomes null so the PUT clears the stored value', () => {
    const payload = formDataToPayload(makeFormData({ preBackupCommands: '' }));
    expect(payload.preBackupCommands).toBeNull();
    expect(JSON.stringify(payload)).toContain('"preBackupCommands":null');
  });

  test('whitespace-only becomes null', () => {
    const payload = formDataToPayload(makeFormData({ preBackupCommands: ' \n\t ' }));
    expect(payload.preBackupCommands).toBeNull();
  });

  test('keeps a non-empty value exactly (including newlines)', () => {
    const commands = 'echo "before"\n/opt/app/stop.sh\n';
    const payload = formDataToPayload(makeFormData({ preBackupCommands: commands }));
    expect(payload.preBackupCommands).toBe(commands);
  });

  test('is omitted for S3 sources, Git sources and instance backups', () => {
    const value = 'echo hi';
    expect(
      formDataToPayload(
        makeFormData({ sourceKind: 's3', sourceS3ProfileId: 's3p1', preBackupCommands: value })
      ).preBackupCommands
    ).toBeUndefined();
    expect(
      formDataToPayload(
        makeFormData({ sourceKind: 'git', sourceGitRepoId: 'repo1', preBackupCommands: value })
      ).preBackupCommands
    ).toBeUndefined();
    expect(
      formDataToPayload(
        makeFormData({ sourceType: 'lazybackup_instance', preBackupCommands: value })
      ).preBackupCommands
    ).toBeUndefined();
  });
});

describe('formDataToPayload excludePatterns', () => {
  test('empty string becomes null so the PUT clears the stored value', () => {
    const payload = formDataToPayload(makeFormData({ excludePatterns: '' }));
    expect(payload.excludePatterns).toBeNull();
    expect(JSON.stringify(payload)).toContain('"excludePatterns":null');
  });

  test('whitespace-only becomes null', () => {
    const payload = formDataToPayload(makeFormData({ excludePatterns: '  \n ' }));
    expect(payload.excludePatterns).toBeNull();
  });

  test('keeps a non-empty value exactly', () => {
    const patterns = '*.log\nnode_modules\n.cache';
    const payload = formDataToPayload(makeFormData({ excludePatterns: patterns }));
    expect(payload.excludePatterns).toBe(patterns);
  });

  test('is omitted for database, instance and Git sources', () => {
    const value = '*.log';
    expect(
      formDataToPayload(makeFormData({ sourceType: 'database', excludePatterns: value }))
        .excludePatterns
    ).toBeUndefined();
    expect(
      formDataToPayload(makeFormData({ sourceType: 'lazybackup_instance', excludePatterns: value }))
        .excludePatterns
    ).toBeUndefined();
    expect(
      formDataToPayload(makeFormData({ sourceType: 'git_repo', excludePatterns: value }))
        .excludePatterns
    ).toBeUndefined();
  });
});

describe('formDataToPayload other fields', () => {
  test('does not alter unrelated payload fields', () => {
    const data = makeFormData({
      name: 'Web data',
      destinationPath: '/backups/web',
      sourcePath: '/var/www',
      schedule: '30 3 * * *',
      enabled: false,
      versionsToKeep: 12,
    });
    const payload = formDataToPayload(data);

    expect(payload.name).toBe('Web data');
    expect(payload.destinationPath).toBe('/backups/web');
    expect(payload.sourcePath).toBe('/var/www');
    expect(payload.schedule).toBe('30 3 * * *');
    expect(payload.enabled).toBe(false);
    expect(payload.versionsToKeep).toBe(12);
    expect(payload.sourceKind).toBe('local');
    expect(payload.destinationKind).toBe('local');
    expect(payload.sourceType).toBe('path');
    expect(payload.serverId).toBeNull();
    expect(payload.destinationServerId).toBeNull();
    expect(payload.dbEngine).toBeNull();
  });
});
