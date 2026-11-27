import { describe, expect, test } from 'bun:test';
import { homedir } from 'os';
import { resolveSystemKeyPath } from './index';

const home = process.env.HOME || homedir();

describe('resolveSystemKeyPath', () => {
  test('expands ~ and ~/… to the current user home', () => {
    expect(resolveSystemKeyPath('~')).toBe(home);
    expect(resolveSystemKeyPath('~/.ssh/id_ed25519')).toBe(`${home}/.ssh/id_ed25519`);
  });

  test('leaves ~user paths untouched', () => {
    expect(resolveSystemKeyPath('~deploy/.ssh/id_ed25519')).toBe(
      '~deploy/.ssh/id_ed25519'
    );
  });

  test('keeps absolute paths', () => {
    expect(resolveSystemKeyPath('/etc/ssh/id_ed25519')).toBe('/etc/ssh/id_ed25519');
  });

  test('keeps relative paths relative', () => {
    expect(resolveSystemKeyPath('.ssh/id_ed25519')).toBe('.ssh/id_ed25519');
    expect(resolveSystemKeyPath('keys/id_ed25519')).toBe('keys/id_ed25519');
  });

  test('trims surrounding whitespace', () => {
    expect(resolveSystemKeyPath('  ~/.ssh/id_ed25519  ')).toBe(
      `${home}/.ssh/id_ed25519`
    );
  });
});
