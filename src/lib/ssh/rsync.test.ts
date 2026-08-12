import { describe, expect, test } from 'bun:test';
import {
  buildFindCommand,
  buildRsyncArgv,
  buildRsyncCommand,
  shellSingleQuote,
  sshUserHost,
} from './rsync';

describe('shellSingleQuote', () => {
  test('escapes single quotes', () => {
    expect(shellSingleQuote("foo'bar")).toBe(`'foo'\\''bar'`);
  });
});

describe('sshUserHost', () => {
  test('joins user@host', () => {
    expect(sshUserHost('deploy', '10.0.0.1')).toBe('deploy@10.0.0.1');
  });

  test('rejects newlines', () => {
    expect(() => sshUserHost('u\n', 'host')).toThrow();
    expect(() => sshUserHost('u', 'host\n')).toThrow();
  });
});

describe('buildRsyncArgv', () => {
  test('passes excludes as argv --exclude=', () => {
    const argv = buildRsyncArgv({
      sourcePath: '/src/',
      destinationPath: '/dest',
      excludePatterns: ['*.log', "foo'bar"],
    });
    expect(argv[0]).toBe('-avz');
    expect(argv).toContain('--exclude=*.log');
    expect(argv).toContain("--exclude=foo'bar");
    expect(argv.at(-2)).toBe('/src/');
    expect(argv.at(-1)).toBe('/dest');
    expect(argv.join(' ')).not.toContain('--exclude="');
  });

  test('rejects newline in paths', () => {
    expect(() =>
      buildRsyncArgv({ sourcePath: '/src\n/evil', destinationPath: '/dest' })
    ).toThrow(/invalid characters/i);
  });
});

describe('buildRsyncCommand', () => {
  test('single-quotes interpolated values for remote shells', () => {
    const cmd = buildRsyncCommand('/src', '/dest', ['*.tmp']);
    expect(cmd.startsWith('rsync ')).toBe(true);
    expect(cmd).toContain(shellSingleQuote('/src'));
    expect(cmd).toContain(shellSingleQuote('--exclude=*.tmp'));
    expect(cmd).not.toContain('--exclude="');
  });
});

describe('buildFindCommand', () => {
  test('quotes remote path and does not interpolate excludes into double quotes', () => {
    const cmd = buildFindCommand('/var/www', ['*.log', 'secret"file']);
    expect(cmd).toContain("cd '/var/www'");
    expect(cmd).toContain('find .');
    expect(cmd).toContain(shellSingleQuote('./*.log'));
    expect(cmd).not.toContain('find "/var/www"');
    expect(cmd).not.toContain('| sed');
  });

  test('rejects newline in remote path', () => {
    expect(() => buildFindCommand('/tmp/\n/etc')).toThrow();
  });
});
