import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildRemoteDestWritableCommand,
  buildRemotePathKindCommand,
  parseRemotePathKind,
} from './remote-path-probe';

function runShell(
  command: string,
  cwd?: string,
  env?: Record<string, string>
): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('bash', ['-c', command], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '' };
  }
}

describe('remote path probe quoting', () => {
  test('classifies directories, files, and missing paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbprobe-'));
    const dir = path.join(root, 'plain');
    await fs.mkdir(dir);
    const file = path.join(root, 'plain.txt');
    await fs.writeFile(file, 'x');

    expect(runShell(buildRemotePathKindCommand(dir)).stdout.trim()).toBe('dir');
    expect(runShell(buildRemotePathKindCommand(file)).stdout.trim()).toBe('file');
    expect(
      runShell(buildRemotePathKindCommand(path.join(root, 'nope'))).stdout.trim()
    ).toBe('missing');
  });

  test('handles quotes, spaces, unicode, and shell metacharacters literally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbprobe-'));
    const names = [
      'p space',
      "p 'quote'",
      'p "double"',
      'p $dollar',
      'p `backtick`',
      'p ünïcode-日本',
      'p $(touch CANARY)',
      'p;touch CANARY',
    ];

    for (const name of names) {
      const dir = path.join(root, name);
      await fs.mkdir(dir);
      const result = runShell(buildRemotePathKindCommand(dir), root);
      expect(result.stdout.trim()).toBe('dir');
    }
    expect(await fs.readdir(root)).not.toContain('CANARY');
  });

  test('parses only known kinds', () => {
    expect(parseRemotePathKind('dir\n')).toBe('dir');
    expect(parseRemotePathKind('file')).toBe('file');
    expect(parseRemotePathKind('missing\n')).toBe('missing');
    expect(parseRemotePathKind('bash: p: No such file')).toBe('missing');
    expect(parseRemotePathKind(null)).toBe('missing');
  });

  test('expands a leading ~ on the remote host like rsync/scp', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbprobe-home-'));
    await fs.mkdir(path.join(root, 'backups'));
    try {
      expect(
        runShell(buildRemotePathKindCommand('~/backups'), undefined, { HOME: root })
          .stdout.trim()
      ).toBe('dir');
      expect(
        runShell(buildRemoteDestWritableCommand('~/new-dir'), undefined, { HOME: root }).code
      ).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('dest writable command accepts an existing path and a creatable child', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lbprobe-'));
    expect(runShell(buildRemoteDestWritableCommand(root)).code).toBe(0);
    expect(
      runShell(buildRemoteDestWritableCommand(path.join(root, "new 'dir' with space")))
        .code
    ).toBe(0);
  });

  test('probe commands do not require bash on the remote host', () => {
    // Alpine/BusyBox SSH targets ship no bash. Both probes must run under a
    // POSIX `sh`, otherwise a real artifact is reported as missing.
    expect(buildRemotePathKindCommand('/srv/backups')).not.toMatch(/\bbash\b/);
    expect(buildRemoteDestWritableCommand('/srv/backups')).not.toMatch(/\bbash\b/);
    expect(buildRemotePathKindCommand('/srv/backups')).toMatch(/^sh -lc /);
    expect(buildRemoteDestWritableCommand('/srv/backups')).toMatch(/^sh -lc /);
  });
});
