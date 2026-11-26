import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildAuthorizedKeysEntry,
  buildEphemeralKeyMarker,
  buildRemoveAuthorizedKeysCommand,
  EPHEMERAL_KEY_MARKER_PREFIX,
  runEphemeralDirectRsync,
  stripAuthorizedKeysMarker,
} from '@/lib/ssh/ephemeral';
import type { NodeSSH } from 'node-ssh';

describe('ephemeral authorized_keys helpers', () => {
  test('builds marker with prefix', () => {
    const marker = buildEphemeralKeyMarker('abc123');
    expect(marker).toBe(`${EPHEMERAL_KEY_MARKER_PREFIX}abc123`);
  });

  test('builds authorized_keys entry with marker comment', () => {
    const entry = buildAuthorizedKeysEntry(
      'lazybackup-ephemeral:test',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey data'
    );
    expect(entry).toContain('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey data');
    expect(entry.endsWith('lazybackup-ephemeral:test')).toBe(true);
  });

  test('strips marked lines from authorized_keys content', () => {
    const marker = 'lazybackup-ephemeral:xyz';
    const content = [
      'ssh-ed25519 AAAAkeep keep@host',
      `ssh-ed25519 AAAAtemp ${marker}`,
      'ssh-rsa AAAAalso keep2@host',
      '',
    ].join('\n');

    const cleaned = stripAuthorizedKeysMarker(content, marker);
    expect(cleaned).toContain('AAAAkeep');
    expect(cleaned).toContain('AAAAalso');
    expect(cleaned).not.toContain(marker);
    expect(cleaned).not.toContain('AAAAtemp');
  });

  test('remove command embeds marker safely for sed', () => {
    const cmd = buildRemoveAuthorizedKeysCommand('lazybackup-ephemeral:abc');
    expect(cmd).toContain("sed -i '/lazybackup-ephemeral:abc/d'");
    expect(cmd).toContain('authorized_keys');
  });
});

describe('runEphemeralDirectRsync option injection', () => {
  const prevKnownHosts = process.env.LAZYBACKUP_KNOWN_HOSTS;
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-secinj-'));
    process.env.LAZYBACKUP_KNOWN_HOSTS = path.join(tmpDir, 'known_hosts');
  });

  afterEach(async () => {
    if (prevKnownHosts === undefined) delete process.env.LAZYBACKUP_KNOWN_HOSTS;
    else process.env.LAZYBACKUP_KNOWN_HOSTS = prevKnownHosts;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('rejects a server source path rsync would parse as an option', async () => {
    const commands: string[] = [];
    const fakeSsh = {
      putFile: async () => undefined,
      execCommand: async (command: string) => {
        commands.push(command);
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as NodeSSH;

    await expect(
      runEphemeralDirectRsync({
        sourceSsh: fakeSsh,
        sourcePath: '--rsync-path=touch /tmp/lbtest-secinj/pwned',
        destUsername: 'backup',
        destHost: '10.0.0.2',
        destPort: 22,
        destPath: '/srv/backups',
        ephemeralPrivateKeyPath: path.join(tmpDir, 'id_ed25519'),
      })
    ).rejects.toThrow(/must not start with "-"/);

    // Pre-fix this command contains the unquoted option as rsync's source
    // positional, so rsync runs it on the destination host.
    expect(commands.join('\n')).not.toContain('--rsync-path');
  });
});
