import { describe, expect, test } from 'bun:test';
import { redactBackup, redactS3, redactServer } from './redact';

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
});
