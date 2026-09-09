import { describe, expect, test } from 'bun:test';
import { buildGitSshCommand, gitRepoSlug, gitUrlNeedsSshKey, parseGitUrl } from './mirror';

describe('parseGitUrl', () => {
  test('parses scp-like SSH URLs', () => {
    expect(parseGitUrl('git@github.com:org/repo.git')).toEqual({
      scheme: 'ssh',
      host: 'github.com',
      port: 22,
      url: 'git@github.com:org/repo.git',
    });
  });

  test('parses ssh:// URLs with an explicit port', () => {
    expect(parseGitUrl('ssh://git@gitlab.example:2222/group/repo.git')).toEqual({
      scheme: 'ssh',
      host: 'gitlab.example',
      port: 2222,
      url: 'ssh://git@gitlab.example:2222/group/repo.git',
    });
  });

  test('parses https URLs', () => {
    expect(parseGitUrl('https://github.com/org/repo.git')).toEqual({
      scheme: 'https',
      host: 'github.com',
      port: 443,
      url: 'https://github.com/org/repo.git',
    });
  });

  test('rejects embedded HTTPS credentials', () => {
    expect(() => parseGitUrl('https://user:pass@github.com/org/repo.git')).toThrow(
      /credentials/i
    );
  });

  test('rejects newlines', () => {
    expect(() => parseGitUrl('git@host:repo.git\n-evil')).toThrow(/invalid characters/i);
  });

  test('rejects empty', () => {
    expect(() => parseGitUrl('  ')).toThrow(/required/i);
  });
});

describe('gitUrlNeedsSshKey', () => {
  test('SSH URLs need a key', () => {
    expect(gitUrlNeedsSshKey('git@github.com:org/repo.git')).toBe(true);
    expect(gitUrlNeedsSshKey('https://github.com/org/repo.git')).toBe(false);
  });
});

describe('gitRepoSlug', () => {
  test('uses the last path segment without .git', () => {
    expect(gitRepoSlug('git@github.com:Org/My-Repo.git')).toBe('my-repo');
    expect(gitRepoSlug('https://github.com/org/lazybackup')).toBe('lazybackup');
  });
});

describe('buildGitSshCommand', () => {
  test('builds GIT_SSH_COMMAND with a temp identity and isolated ssh config', async () => {
    const { command, cleanup } = await buildGitSshCommand(
      '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
      2222
    );
    try {
      expect(command).toContain('ssh');
      expect(command).toContain('-p 2222');
      expect(command).toContain('-i');
      expect(command).toContain('-F /dev/null');
    } finally {
      await cleanup();
    }
  });
});
