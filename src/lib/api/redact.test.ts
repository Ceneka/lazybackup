import { describe, expect, test } from 'bun:test';
import { BEARER_REDACTED_SETTING_KEYS } from '@/lib/auth/constants';
import {
  isBearerAudience,
  redactBackup,
  redactDbHints,
  redactHistoryEntry,
  redactS3,
  redactServer,
  redactSettingsForBearer,
  redactSshKey,
} from './redact';

describe('redactServer', () => {
  test('strips secrets and sets flags', () => {
    const result = redactServer({
      id: 's1',
      name: 'box',
      password: 'secret',
      privateKey: '-----BEGIN-----',
      host: '1.2.3.4',
    });
    expect(result).toMatchObject({
      id: 's1',
      name: 'box',
      host: '1.2.3.4',
      hasPassword: true,
      hasPrivateKey: true,
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('privateKey');
  });

  test('flags false when empty', () => {
    const result = redactServer({ id: 's1', password: null, privateKey: '' });
    expect(result.hasPassword).toBe(false);
    expect(result.hasPrivateKey).toBe(false);
  });
});

describe('redactS3', () => {
  test('strips secret key and keeps access key by default', () => {
    const result = redactS3({
      id: 'p1',
      accessKeyId: 'AKIA123456',
      secretAccessKey: 'supersecret',
      bucket: 'b',
    });
    expect(result.accessKeyId).toBe('AKIA123456');
    expect(result.hasSecretAccessKey).toBe(true);
    expect(result).not.toHaveProperty('secretAccessKey');
  });

  test('masks access key when requested', () => {
    const result = redactS3(
      { accessKeyId: 'AKIA123456', secretAccessKey: 'x' },
      { maskAccessKeyId: true }
    );
    expect(result.accessKeyId).toBe('AKIA…');
  });
});

describe('redactBackup', () => {
  test('redacts nested endpoints and db password', () => {
    const result = redactBackup({
      id: 'b1',
      dbPassword: 'dbsecret',
      server: { id: 's1', password: 'p', privateKey: null },
      destinationS3Profile: {
        id: 'p1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'sec',
      },
    });
    expect(result).not.toHaveProperty('dbPassword');
    expect(result.hasDbPassword).toBe(true);
    expect(result.server).toMatchObject({ hasPassword: true, hasPrivateKey: false });
    expect(result.server).not.toHaveProperty('password');
    expect(result.destinationS3Profile).not.toHaveProperty('secretAccessKey');
  });

  test('redacts instance backup passphrase', () => {
    const result = redactBackup({
      id: 'b1',
      instanceBackupPassphrase: 'wrap-secret',
    });
    expect(result).not.toHaveProperty('instanceBackupPassphrase');
    expect(result.hasInstanceBackupPassphrase).toBe(true);
  });
});

describe('redactHistoryEntry', () => {
  test('redacts nested backupConfig secrets', () => {
    const result = redactHistoryEntry({
      id: 'h1',
      status: 'success',
      artifactPath: '/backups/x',
      backupConfig: {
        id: 'b1',
        dbPassword: 'dbsecret',
        instanceBackupPassphrase: 'wrap',
        server: { id: 's1', password: 'p', privateKey: '-----BEGIN-----' },
        destinationS3Profile: {
          id: 'p1',
          secretAccessKey: 'sec',
        },
      },
    });
    expect(result.id).toBe('h1');
    expect(result.artifactPath).toBe('/backups/x');
    expect(result.backupConfig).not.toHaveProperty('dbPassword');
    expect(result.backupConfig).not.toHaveProperty('instanceBackupPassphrase');
    expect(result.backupConfig).toMatchObject({
      hasDbPassword: true,
      hasInstanceBackupPassphrase: true,
    });
    expect(result.backupConfig.server).not.toHaveProperty('password');
    expect(result.backupConfig.server).not.toHaveProperty('privateKey');
    expect(result.backupConfig.destinationS3Profile).not.toHaveProperty(
      'secretAccessKey'
    );
  });

  test('leaves rows without backupConfig unchanged', () => {
    const result = redactHistoryEntry({ id: 'h1', status: 'failed' });
    expect(result).toEqual({ id: 'h1', status: 'failed' });
  });
});

describe('redactSshKey', () => {
  test('list shape never includes PEM', () => {
    const result = redactSshKey({
      id: 'k1',
      name: 'laptop',
      privateKeyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret',
      privateKeyPath: null,
    });
    expect(result).not.toHaveProperty('privateKeyContent');
    expect(result.hasPrivateKeyContent).toBe(true);
    expect(result).toMatchObject({ id: 'k1', name: 'laptop' });
  });

  test('session reveal keeps PEM and flag', () => {
    const result = redactSshKey(
      { id: 'k1', privateKeyContent: '-----BEGIN-----' },
      { includePrivateKeyContent: true }
    );
    expect(result.privateKeyContent).toBe('-----BEGIN-----');
    expect(result.hasPrivateKeyContent).toBe(true);
  });

  test('flags false when empty', () => {
    const result = redactSshKey({ id: 'k1', privateKeyContent: '' });
    expect(result.hasPrivateKeyContent).toBe(false);
    expect(result).not.toHaveProperty('privateKeyContent');
  });
});

describe('redactDbHints', () => {
  test('session keeps password', () => {
    const result = redactDbHints(
      { container: 'db', engine: 'postgres', password: 'secret', found: true },
      { includePassword: true }
    );
    expect(result.password).toBe('secret');
    expect(result.hasPassword).toBe(true);
  });

  test('Bearer omits password and sets hasPassword', () => {
    const result = redactDbHints({
      container: 'db',
      engine: 'postgres',
      password: 'secret',
      found: true,
    });
    expect(result).not.toHaveProperty('password');
    expect(result.hasPassword).toBe(true);
    expect(result.container).toBe('db');
  });
});

describe('redactSettingsForBearer', () => {
  test('drops webhook and success-ping secrets', () => {
    const result = redactSettingsForBearer({
      timezone: 'UTC',
      failureWebhookUrl: 'https://hooks.example/bot-token',
      failureWebhookHeaders: '{"Authorization":"Bearer x"}',
      failureWebhookBody: '{"text":"{{errorMessage}}"}',
      failureWebhookMethod: 'POST',
      successPingUrl: 'https://hc-ping.com/uuid',
      successPingHeaders: 'X-Token: secret',
      successPingBody: 'ok',
      successPingMethod: 'GET',
    });
    expect(result.timezone).toBe('UTC');
    expect(result.failureWebhookMethod).toBe('POST');
    expect(result.successPingMethod).toBe('GET');
    for (const key of BEARER_REDACTED_SETTING_KEYS) {
      expect(result).not.toHaveProperty(key);
    }
  });
});

describe('isBearerAudience', () => {
  test('only bearer is redacted', () => {
    expect(isBearerAudience('bearer')).toBe(true);
    expect(isBearerAudience('session')).toBe(false);
    expect(isBearerAudience('unlocked')).toBe(false);
    expect(isBearerAudience('none')).toBe(false);
  });
});
