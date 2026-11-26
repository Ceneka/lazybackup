import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildAuthorizedKeysEntry,
  buildEphemeralKeyMarker,
  buildReachabilityProbeCommand,
  buildRemoveAuthorizedKeysCommand,
  ensureRemoteDirectory,
  EPHEMERAL_KEY_MARKER_PREFIX,
  cleanupRemoteOldFiles,
  cleanupRemoteOldVersions,
  runEphemeralDirectRsync,
  stripAuthorizedKeysMarker,
} from '@/lib/ssh/ephemeral';
import { remotePathShellWord } from '@/lib/ssh/rsync';
import { sshStrictHostKeyPinnedCliOptions } from '@/lib/ssh/known-hosts';
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

  test('reachability probe is valid POSIX shell syntax', () => {
    const cmd = buildReachabilityProbeCommand('box.example', 2222);
    // `PATH=… ( … )` used to be a syntax error, which forced every S2S transfer to relay.
    expect(() => execFileSync('sh', ['-n', '-c', cmd], { stdio: 'pipe' })).not.toThrow();
    expect(cmd).toContain('export PATH=');
    expect(cmd).not.toMatch(/PATH="[^"]*"\s+\(/);
  });

  test('reachability probe quotes the destination host', () => {
    const cmd = buildReachabilityProbeCommand("evil'; touch /tmp/pwn; '", 22);
    expect(cmd).toContain(`'evil'\\''; touch /tmp/pwn; '\\'''`);
    expect(cmd).toContain('exec 3<>/dev/tcp/"$1"/"$2"');
    expect(() => execFileSync('sh', ['-n', '-c', cmd], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('remote path expansion and mkdir safety', () => {
  test('expands a leading ~ the way rsync/scp do', () => {
    expect(remotePathShellWord('~/backups')).toBe(`"$HOME"/'backups'`);
    expect(remotePathShellWord('~')).toBe('"$HOME"');
    expect(remotePathShellWord('/srv/backups')).toBe(`'/srv/backups'`);
    expect(remotePathShellWord("/srv/it's here")).toBe(`'/srv/it'\\''s here'`);
  });

  test('ensureRemoteDirectory uses mkdir -p -- and expands ~', async () => {
    const commands: string[] = [];
    const fakeSsh = {
      execCommand: async (command: string) => {
        commands.push(command);
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as NodeSSH;

    await ensureRemoteDirectory(fakeSsh, '~/my backups');
    await ensureRemoteDirectory(fakeSsh, '-leading-dash');

    expect(commands[0]).toContain('mkdir -p -- "$HOME"/\'my backups\'');
    expect(commands[1]).toContain("mkdir -p -- '-leading-dash'");
    expect(commands[0]).not.toMatch(/mkdir -p '/);
  });

  test('pinned known_hosts options fail on unknown hosts', () => {
    const options = sshStrictHostKeyPinnedCliOptions('/tmp/kh');
    expect(options).toContain('StrictHostKeyChecking=yes');
    expect(options).not.toContain('StrictHostKeyChecking=accept-new');
    expect(options).toContain('UserKnownHostsFile=/tmp/kh');
  });

  test('retention helpers expand ~ and protect leading dashes', async () => {
    const commands: string[] = [];
    const fakeSsh = {
      execCommand: async (command: string) => {
        commands.push(command);
        if (command.includes('ls -1')) {
          return {
            code: 0,
            stdout: '2020-01-01_00-00-00\n2021-01-01_00-00-00\n',
            stderr: '',
          };
        }
        if (command.includes('find ')) {
          return { code: 0, stdout: '1600000000 old.sql.gz\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as NodeSSH;

    await cleanupRemoteOldVersions(fakeSsh, '~/versions', 1);
    await cleanupRemoteOldFiles(fakeSsh, '~/files', 1, 'days', 0);

    expect(commands[0]).toContain(`ls -1 -- "$HOME"/'versions'`);
    expect(commands[1]).toContain(`rm -rf -- "$HOME"/'versions/2020-01-01_00-00-00'`);
    expect(commands[2]).toContain(`find "$HOME"/'files'`);
    expect(commands[3]).toContain(`rm -f -- "$HOME"/'files/old.sql.gz'`);
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

  test('direct rsync trusts only pinned destination host keys', async () => {
    const commands: string[] = [];
    const fakeSsh = {
      putFile: async () => undefined,
      execCommand: async (command: string) => {
        commands.push(command);
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as NodeSSH;

    await runEphemeralDirectRsync({
      sourceSsh: fakeSsh,
      sourcePath: '/srv/data',
      destUsername: 'backup',
      destHost: '10.0.0.2',
      destPort: 2222,
      destPath: '~/dest',
      ephemeralPrivateKeyPath: path.join(tmpDir, 'id_ed25519'),
    });

    const rsyncCommand = commands.find((command) => command.includes('rsync -avz'));
    expect(rsyncCommand).toBeDefined();
    expect(rsyncCommand).toContain('StrictHostKeyChecking=yes');
    expect(rsyncCommand).not.toContain('accept-new');
    expect(rsyncCommand).toContain('backup@10.0.0.2:~/dest');
  });
});
