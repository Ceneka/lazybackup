import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { buildSshGitCommand, sshGitEnv } from './ssh-env';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lazybackup-git-ssh-env-'));
}

/**
 * Run the command the way git does (`sh -c "$GIT_SSH_COMMAND <host>"`) with a
 * fake `ssh` first on PATH, and return the argv the fake received.
 */
function sshArgvFromCommand(dir: string, command: string): string[] {
  const fakeSsh = path.join(dir, 'ssh');
  writeFileSync(fakeSsh, '#!/bin/sh\nfor arg in "$@"; do printf "%s\\n" "$arg"; done\n', {
    mode: 0o755,
  });
  const stdout = execFileSync('sh', ['-c', `${command} git@example.com`], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  return stdout.split('\n').filter((line) => line !== '');
}

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.LAZYBACKUP_SSH_ENV_MARKER;
});

describe('buildSshGitCommand', () => {
  test('quotes every token and keeps option values intact', () => {
    const command = buildSshGitCommand('/tmp/keys/id_test', '/tmp/known_hosts', {
      port: 2222,
    });

    expect(command.startsWith("'ssh' ")).toBe(true);
    expect(command).toContain("'-p' '2222'");
    expect(command).toContain("'-o' 'ConnectTimeout=10'");
    expect(command).toContain("'-o' 'ConnectionAttempts=1'");
    expect(command).toContain("'-o' 'BatchMode=yes'");
    expect(command).toContain("'-o' 'StrictHostKeyChecking=accept-new'");
    expect(command).toContain("'-i' '/tmp/keys/id_test'");
    expect(command).toContain("'-F' '/dev/null'");
  });

  test('a key path with shell metacharacters stays a single argv token', () => {
    const dir = tempDir();
    cleanupDirs.push(dir);
    const sentinel = path.join(dir, 'pwned');
    const keyPath = `${dir}/id; touch ${sentinel}`;

    const command = buildSshGitCommand(keyPath, path.join(dir, 'known_hosts'));
    const argv = sshArgvFromCommand(dir, command);

    expect(argv).toContain(keyPath);
    expect(argv).not.toContain(';');
    expect(existsSync(sentinel)).toBe(false);
  });

  test('omits the identity when no key path is given', () => {
    const command = buildSshGitCommand(undefined, '/tmp/known_hosts');
    expect(command).not.toContain("'-i'");
    expect(command).not.toContain("'-F'");
  });

  test('rejects newlines in a key path', () => {
    expect(() =>
      buildSshGitCommand('/tmp/id\nProxyCommand=evil', '/tmp/known_hosts')
    ).toThrow(/invalid characters/i);
  });
});

describe('sshGitEnv', () => {
  test('merges over process.env and disables interactive prompts', async () => {
    const dir = tempDir();
    cleanupDirs.push(dir);
    process.env.LAZYBACKUP_SSH_ENV_MARKER = 'kept';

    const env = await sshGitEnv(path.join(dir, 'id'), { port: 22 });

    expect(env.LAZYBACKUP_SSH_ENV_MARKER).toBe('kept');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBe('echo');
    expect(env.GIT_SSH_COMMAND).toContain("'-i'");
    expect(env.GIT_SSH_COMMAND).toContain("'-F' '/dev/null'");
  });
});
