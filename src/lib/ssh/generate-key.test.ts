import { describe, expect, test } from 'bun:test';
import {
  buildAuthorizedKeysInstallCommand,
  derivePublicKeyFromPrivate,
  generateStoredEd25519KeyPair,
} from '@/lib/ssh/generate-key';

describe('authorized_keys install command', () => {
  test('builds an idempotent one-liner with the public key', () => {
    const pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey lazybackup';
    const cmd = buildAuthorizedKeysInstallCommand(pub);

    expect(cmd).toContain('mkdir -p ~/.ssh');
    expect(cmd).toContain('chmod 700 ~/.ssh');
    expect(cmd).toContain('authorized_keys');
    expect(cmd).toContain("grep -qxF 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey lazybackup'");
    expect(cmd).toContain("echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey lazybackup' >> ~/.ssh/authorized_keys");
  });

  test('shell-escapes single quotes in the public key comment', () => {
    const pub = "ssh-ed25519 AAAAtest comment'with'quotes";
    const cmd = buildAuthorizedKeysInstallCommand(pub);
    expect(cmd).toContain(`'ssh-ed25519 AAAAtest comment'\\''with'\\''quotes'`);
  });

  test('rejects empty public key', () => {
    expect(() => buildAuthorizedKeysInstallCommand('   ')).toThrow('Public key is required');
  });
});

describe('ssh-keygen generate + derive', () => {
  test('round-trips private → public', async () => {
    const { privateKey, publicKey } = await generateStoredEd25519KeyPair('lazybackup-test');
    expect(privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(publicKey.startsWith('ssh-ed25519 ')).toBe(true);
    expect(publicKey).toContain('lazybackup-test');

    const derived = await derivePublicKeyFromPrivate(privateKey);
    // ssh-keygen -y may omit or keep the comment; fingerprint material must match
    expect(derived.split(' ')[0]).toBe('ssh-ed25519');
    expect(derived.split(' ')[1]).toBe(publicKey.split(' ')[1]);
  });
});
