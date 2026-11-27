import { describe, expect, test } from 'bun:test';
import {
  GIT_CLONE_TIMEOUT_MS,
  GIT_DEFAULT_TIMEOUT_MS,
  GIT_LS_REMOTE_TIMEOUT_MS,
  describeGitRunError,
  gitCallTimeout,
} from './mirror';
import { sshGitEnv } from './ssh-env';

// No module mocks here on purpose: mocking `child_process` is process-wide in
// Bun and breaks every other suite that spawns tar/ssh-keygen/sqlite.

function killedError(): Error {
  return Object.assign(new Error('Command failed: git'), {
    killed: true,
    signal: 'SIGTERM',
    code: null,
  });
}

describe('git timeout wiring', () => {
  test('ls-remote keeps the short probe ceiling; clones keep the long one', () => {
    expect(GIT_LS_REMOTE_TIMEOUT_MS).toBe(20_000);
    expect(GIT_CLONE_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(GIT_DEFAULT_TIMEOUT_MS).toBe(120_000);
    expect(gitCallTimeout('ls-remote')).toBe(GIT_LS_REMOTE_TIMEOUT_MS);
    expect(gitCallTimeout('clone')).toBe(GIT_CLONE_TIMEOUT_MS);
  });

  test('a timeout on a probe is reported in seconds and names the host', () => {
    const error = describeGitRunError(
      killedError(),
      ['ls-remote', '--heads', 'git@10.255.255.1:org/repo.git'],
      GIT_LS_REMOTE_TIMEOUT_MS
    );
    expect(error.message).toBe('git ls-remote timed out after 20s — host unreachable?');
  });

  test('ETIMEDOUT and a bare SIGTERM are treated as timeouts too', () => {
    const etimedout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    expect(
      describeGitRunError(etimedout, ['clone', 'x'], 900_000).message
    ).toContain('timed out after 900s');

    const sigterm = Object.assign(new Error('killed'), { signal: 'SIGTERM' });
    expect(describeGitRunError(sigterm, ['clone', 'x'], 900_000).message).toContain(
      'timed out after 900s'
    );
  });

  test('a missing git binary still gets its own message', () => {
    const enoent = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    expect(describeGitRunError(enoent, ['clone'], 1000).message).toContain('git');
    expect(describeGitRunError(enoent, ['clone'], 1000).message.toLowerCase()).toContain(
      'install'
    );
  });

  test('the SSH probe env bounds connection attempts', async () => {
    const env = await sshGitEnv(null);
    expect(env.GIT_SSH_COMMAND).toContain('ConnectTimeout=10');
    expect(env.GIT_SSH_COMMAND).toContain('ConnectionAttempts=1');
    expect(env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
  });
});
