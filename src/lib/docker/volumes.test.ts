import { describe, expect, test } from 'bun:test';
import {
  assertValidDockerVolumeName,
  buildPackDockerVolumeCommand,
  buildRestoreDockerVolumeCommand,
  buildTarExcludeArgs,
  isValidDockerVolumeName,
} from './volumes';

describe('isValidDockerVolumeName', () => {
  test('accepts typical volume names', () => {
    expect(isValidDockerVolumeName('data')).toBe(true);
    expect(isValidDockerVolumeName('my_app.data-1')).toBe(true);
    expect(isValidDockerVolumeName('A')).toBe(true);
  });

  test('rejects empty, paths, and injection-like names', () => {
    expect(isValidDockerVolumeName('')).toBe(false);
    expect(isValidDockerVolumeName('-bad')).toBe(false);
    expect(isValidDockerVolumeName('vol/name')).toBe(false);
    expect(isValidDockerVolumeName("vol';rm -rf /")).toBe(false);
    expect(isValidDockerVolumeName('vol name')).toBe(false);
  });
});

describe('assertValidDockerVolumeName', () => {
  test('throws on invalid names', () => {
    expect(() => assertValidDockerVolumeName('../etc')).toThrow(/Invalid Docker volume name/);
  });
});

describe('buildTarExcludeArgs', () => {
  test('quotes patterns for the shell', () => {
    const args = buildTarExcludeArgs(['*.log', "foo'bar"]);
    expect(args).toContain("--exclude='*.log'");
    expect(args).toContain(`--exclude='foo'\\''bar'`);
  });
});

describe('buildPackDockerVolumeCommand', () => {
  test('builds a safe docker+tar pack command', () => {
    const cmd = buildPackDockerVolumeCommand('myvol', '/tmp/lazybackup-abc', 'myvol.tar.gz', [
      'lost+found',
    ]);
    expect(cmd).toContain('docker run --rm');
    expect(cmd).toContain(`-v 'myvol:/from:ro'`);
    expect(cmd).toContain(`-v '/tmp/lazybackup-abc:/to'`);
    expect(cmd).toContain('alpine');
    expect(cmd).toContain(`tar czf '/to/myvol.tar.gz'`);
    expect(cmd).toContain(`--exclude='lost+found'`);
    expect(cmd).toContain('-C /from .');
  });

  test('rejects invalid volume names before building', () => {
    expect(() =>
      buildPackDockerVolumeCommand('bad;name', '/tmp/lazybackup-x', 'x.tar.gz')
    ).toThrow();
  });
});

describe('buildRestoreDockerVolumeCommand', () => {
  test('builds create+extract command with quoted paths', () => {
    const cmd = buildRestoreDockerVolumeCommand(
      'myvol',
      '/tmp/lazybackup-abc/myvol.tar.gz',
      '/tmp/lazybackup-abc'
    );
    expect(cmd).toContain('docker volume create');
    expect(cmd).toContain('myvol');
    expect(cmd).toContain('myvol:/to');
    expect(cmd).toContain('/from/myvol.tar.gz');
    expect(cmd).toContain('-C /to');
    expect(cmd).toContain('sh -c');
  });
});
