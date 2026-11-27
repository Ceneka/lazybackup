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

  test('trims surrounding whitespace and keeps inner newlines', () => {
    const commands = '  echo "before"\n/opt/app/stop.sh  \n';
    const payload = formDataToPayload(makeFormData({ preBackupCommands: commands }));
    expect(payload.preBackupCommands).toBe('echo "before"\n/opt/app/stop.sh');
  });

  test('is omitted for S3 and Git sources, cleared for instance backups', () => {
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
    ).toBeNull();
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

  test('trims surrounding whitespace and keeps inner newlines', () => {
    const patterns = '  *.log\nnode_modules\n.cache  ';
    const payload = formDataToPayload(makeFormData({ excludePatterns: patterns }));
    expect(payload.excludePatterns).toBe('*.log\nnode_modules\n.cache');
  });

  test('is omitted for database sources and cleared for instance/Git sources', () => {
    const value = '*.log';
    expect(
      formDataToPayload(makeFormData({ sourceType: 'database', excludePatterns: value }))
        .excludePatterns
    ).toBeUndefined();
    expect(
      formDataToPayload(makeFormData({ sourceType: 'lazybackup_instance', excludePatterns: value }))
        .excludePatterns
    ).toBeNull();
    expect(
      formDataToPayload(makeFormData({ sourceType: 'git_repo', excludePatterns: value }))
        .excludePatterns
    ).toBeNull();
  });
});

describe('formDataToPayload instance passphrase', () => {
  test('blank with a stored passphrase is omitted so PUT keeps it', () => {
    const payload = formDataToPayload(
      makeFormData({
        sourceType: 'lazybackup_instance',
        instanceBackupPassphrase: '   ',
        hasInstanceBackupPassphrase: true,
      })
    );
    expect(payload.instanceBackupPassphrase).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('instanceBackupPassphrase');
  });

  test('blank without a stored passphrase sends null', () => {
    const payload = formDataToPayload(
      makeFormData({ sourceType: 'lazybackup_instance', instanceBackupPassphrase: '' })
    );
    expect(payload.instanceBackupPassphrase).toBeNull();
  });

  test('a non-empty passphrase is sent as-is', () => {
    const payload = formDataToPayload(
      makeFormData({
        sourceType: 'lazybackup_instance',
        instanceBackupPassphrase: '  secret-pass-12  ',
      })
    );
    expect(payload.instanceBackupPassphrase).toBe('  secret-pass-12  ');
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
