import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  SSH_PORT_MAX,
  SSH_PORT_MIN,
  serverInputSchema,
  validatePrivateKeyMaterial,
  validatePrivateKeyPath,
  validateServerCredentials,
  validateSshKeyMaterial,
} from '@/lib/ssh/key-validate';

function commandAvailable(command: string): boolean {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

const sshKeygenAvailable = commandAvailable('ssh-keygen');

type GeneratedKey = { dir: string; privateKeyPath: string; publicKeyPath: string };

function generateKey(options: { passphrase?: string } = {}): GeneratedKey {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazybackup-key-validate-'));
  const privateKeyPath = path.join(dir, 'id_ed25519');
  execFileSync('ssh-keygen', [
    '-t',
    'ed25519',
    '-f',
    privateKeyPath,
    '-N',
    options.passphrase ?? '',
    '-C',
    'lazybackup-test',
    '-q',
  ]);
  return { dir, privateKeyPath, publicKeyPath: `${privateKeyPath}.pub` };
}

const runKeygenTest = sshKeygenAvailable ? test : test.skip;

describe('validatePrivateKeyMaterial', () => {
  runKeygenTest('accepts a real ed25519 private key', () => {
    const key = generateKey();
    try {
      const content = readFileSync(key.privateKeyPath, 'utf8');
      expect(validatePrivateKeyMaterial(content)).toEqual({ ok: true });
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  runKeygenTest('accepts literal \\n escapes as stored by JSON clients', () => {
    const key = generateKey();
    try {
      const content = readFileSync(key.privateKeyPath, 'utf8');
      const escaped = content.trim().replace(/\n/g, '\\n');
      expect(validatePrivateKeyMaterial(escaped)).toEqual({ ok: true });
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  runKeygenTest('rejects a public key in the private key field', () => {
    const key = generateKey();
    try {
      const publicKey = readFileSync(key.publicKeyPath, 'utf8');
      const result = validatePrivateKeyMaterial(publicKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/public key/i);
      }
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  runKeygenTest('rejects a passphrase-protected key with a clear message', () => {
    const key = generateKey({ passphrase: 'correct horse battery staple' });
    try {
      const content = readFileSync(key.privateKeyPath, 'utf8');
      const result = validatePrivateKeyMaterial(content);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/passphrase/i);
      }
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  test('rejects empty content', () => {
    expect(validatePrivateKeyMaterial('')).toEqual({
      ok: false,
      message: 'Private key is empty',
    });
    expect(validatePrivateKeyMaterial('   \n\t ').ok).toBe(false);
  });

  test('rejects arbitrary text', () => {
    const result = validatePrivateKeyMaterial('not a key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not valid/i);
    }
  });

  test('rejects a truncated PEM block', () => {
    const truncated = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'AAAA',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');
    expect(validatePrivateKeyMaterial(truncated).ok).toBe(false);
  });

  test('rejects a truncated RSA PEM header without a body', () => {
    const truncated = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(validatePrivateKeyMaterial(truncated).ok).toBe(false);
  });
});

describe('validatePrivateKeyPath', () => {
  runKeygenTest('accepts a readable key file', async () => {
    const key = generateKey();
    try {
      expect(await validatePrivateKeyPath(key.privateKeyPath)).toEqual({
        ok: true,
      });
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  runKeygenTest('rejects a file that does not contain a key', async () => {
    const key = generateKey();
    try {
      writeFileSync(path.join(key.dir, 'garbage'), 'not a key\n');
      const result = await validatePrivateKeyPath(
        path.join(key.dir, 'garbage')
      );
      expect(result.ok).toBe(false);
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });

  test('rejects a missing file with the path in the message', async () => {
    const missing = path.join(tmpdir(), 'lazybackup-definitely-missing-key');
    const result = await validatePrivateKeyPath(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('not found');
      expect(result.message).toContain(missing);
    }
  });

  test('rejects a directory', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lazybackup-key-dir-'));
    try {
      const result = await validatePrivateKeyPath(dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('not a file');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects an empty path', async () => {
    expect(await validatePrivateKeyPath('   ')).toEqual({
      ok: false,
      message: 'Private key path is required',
    });
  });
});

describe('validateSshKeyMaterial', () => {
  test('rejects a key row with neither content nor path', async () => {
    const result = await validateSshKeyMaterial({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('no private key content');
    }
  });

  test('rejects blank content and path', async () => {
    const result = await validateSshKeyMaterial({
      privateKeyContent: '   ',
      privateKeyPath: '   ',
    });
    expect(result.ok).toBe(false);
  });

  runKeygenTest('accepts stored content and stored paths', async () => {
    const key = generateKey();
    try {
      const privateKeyContent = readFileSync(key.privateKeyPath, 'utf8');
      expect(
        await validateSshKeyMaterial({ privateKeyContent })
      ).toEqual({ ok: true });
      expect(
        await validateSshKeyMaterial({ privateKeyPath: key.privateKeyPath })
      ).toEqual({ ok: true });
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });
});

describe('serverInputSchema', () => {
  const base = {
    name: 'srv',
    host: 'example.com',
    username: 'root',
    authType: 'key' as const,
    privateKey: 'placeholder',
  };

  test('accepts ports inside 1..65535', () => {
    for (const port of [SSH_PORT_MIN, 22, SSH_PORT_MAX]) {
      expect(serverInputSchema.safeParse({ ...base, port }).success).toBe(true);
    }
  });

  test('defaults the port to 22', () => {
    expect(serverInputSchema.parse(base).port).toBe(22);
  });

  test('rejects ports outside 1..65535 with a field error', () => {
    for (const port of [0, -1, 65_536, 99_999]) {
      const result = serverInputSchema.safeParse({ ...base, port });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path[0] === 'port');
        expect(issue?.message).toBe('Port must be between 1 and 65535');
      }
    }
  });

  test('rejects a non-integer port', () => {
    expect(
      serverInputSchema.safeParse({ ...base, port: 22.5 }).success
    ).toBe(false);
  });
});

describe('validateServerCredentials', () => {
  test('requires a non-empty password for password auth', async () => {
    for (const password of [undefined, null, '', '   ']) {
      const result = await validateServerCredentials({
        authType: 'password',
        password,
      });
      expect(result).toEqual({
        ok: false,
        field: 'password',
        message: 'Password is required for password authentication',
      });
    }
  });

  test('accepts a non-empty password for password auth', async () => {
    expect(
      await validateServerCredentials({
        authType: 'password',
        password: 'hunter2',
      })
    ).toEqual({ ok: true });
  });

  test('requires a key source for key auth', async () => {
    const result = await validateServerCredentials({ authType: 'key' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('privateKey');
      expect(result.message).toContain('key authentication');
    }
  });

  test('rejects an unparseable inline private key', async () => {
    const result = await validateServerCredentials({
      authType: 'key',
      privateKey: 'not a key',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('privateKey');
      expect(result.message).toMatch(/not valid/i);
    }
  });

  test('rejects a missing system key path', async () => {
    const missing = path.join(tmpdir(), 'lazybackup-missing-system-key');
    const result = await validateServerCredentials({
      authType: 'key',
      systemKeyPath: missing,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('systemKeyPath');
      expect(result.message).toContain('not found');
    }
  });

  test('accepts a stored key id without inline material', async () => {
    expect(
      await validateServerCredentials({
        authType: 'key',
        sshKeyId: 'some-key-id',
      })
    ).toEqual({ ok: true });
  });

  runKeygenTest('accepts a real inline private key', async () => {
    const key = generateKey();
    try {
      const privateKey = readFileSync(key.privateKeyPath, 'utf8');
      expect(
        await validateServerCredentials({ authType: 'key', privateKey })
      ).toEqual({ ok: true });
      expect(
        await validateServerCredentials({
          authType: 'key',
          systemKeyPath: key.privateKeyPath,
        })
      ).toEqual({ ok: true });
    } finally {
      rmSync(key.dir, { recursive: true, force: true });
    }
  });
});
