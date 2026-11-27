import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  assertLocalDockerAvailable,
  assertValidDockerVolumeName,
  buildDockerVolumeRestoreScript,
  buildPackDockerVolumeCommand,
  buildRestoreDockerVolumeCommand,
  buildTarExcludeArgs,
  checkLocalDockerAvailable,
  DockerUnavailableError,
  isDockerCliMissing,
  isValidDockerVolumeName,
  listLocalDockerVolumes,
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
    expect(cmd).toContain('docker volume inspect \'myvol\' >/dev/null');
    expect(cmd).toContain('docker run --rm');
    // --mount + volume-nocopy: `-v` would auto-create a missing volume (empty backup).
    expect(cmd).toContain(
      `--mount 'type=volume,source=myvol,target=/data,volume-nocopy'`
    );
    expect(cmd).toContain(`-v '/tmp/lazybackup-abc:/to'`);
    expect(cmd).toContain('alpine');
    expect(cmd).toContain(`tar czf '/to/myvol.tar.gz'`);
    expect(cmd).toContain(`--exclude='lost+found'`);
    expect(cmd).toContain('-C /data .');
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
    expect(cmd).toContain('*/../*');
    expect(cmd).toContain('Refusing absolute tar member');
  });

  test('alpine restore script is valid POSIX shell', () => {
    const script = buildDockerVolumeRestoreScript('/from/myvol.tar.gz');
    expect(() =>
      execFileSync('sh', ['-n', '-c', script], { stdio: 'pipe' })
    ).not.toThrow();
  });
});

describe('buildDockerVolumeRestoreScript behaviour (fake tar)', () => {
  async function runWithMembers(members: string[]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-tar-safety-'));
    const bin = path.join(root, 'bin');
    await fs.mkdir(bin);
    const listFile = path.join(root, 'members.txt');
    const marker = path.join(root, 'extracted.txt');
    await fs.writeFile(listFile, members.join('\n') + '\n');
    await fs.writeFile(
      path.join(bin, 'tar'),
      [
        '#!/bin/sh',
        'case "$1" in',
        `  tzf) cat '${listFile}' ;;`,
        '  --help) echo "busybox tar" ;;',
        `  xzf) echo extracted > '${marker}' ;;`,
        'esac',
        'exit 0',
      ].join('\n'),
      { mode: 0o755 }
    );
    try {
      execFileSync('sh', ['-c', buildDockerVolumeRestoreScript('/from/vol.tar.gz')], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: 'pipe',
      });
      return { ok: true, markerExists: (await fs.stat(marker).catch(() => null)) !== null };
    } catch (error) {
      const err = error as { stderr?: Buffer; status?: number };
      return {
        ok: false,
        status: err.status,
        stderr: err.stderr?.toString() ?? '',
        markerExists: (await fs.stat(marker).catch(() => null)) !== null,
      };
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  test('extracts ordinary members', async () => {
    const result = await runWithMembers(['./', './a.txt', './sub/', './sub/b.txt']);
    expect(result).toEqual({ ok: true, markerExists: true });
  });

  test('rejects absolute member names', async () => {
    const result = await runWithMembers(['a.txt', '/etc/passwd']);
    expect(result.ok).toBe(false);
    expect(result.markerExists).toBe(false);
    expect(result.stderr).toContain('Refusing absolute tar member');
  });

  test('rejects traversal member names', async () => {
    const result = await runWithMembers(['a.txt', '../outside']);
    expect(result.ok).toBe(false);
    expect(result.markerExists).toBe(false);
    expect(result.stderr).toContain('Refusing tar member path traversal');
  });
});

describe('isDockerCliMissing', () => {
  test('detects shell output for a missing docker binary', () => {
    expect(isDockerCliMissing('/bin/sh: 1: docker: not found')).toBe(true);
    expect(isDockerCliMissing('/bin/sh: docker: not found')).toBe(true);
    expect(isDockerCliMissing('sh: docker: not found')).toBe(true);
    expect(isDockerCliMissing('docker: not found')).toBe(true);
    expect(isDockerCliMissing('docker: command not found')).toBe(true);
    expect(
      isDockerCliMissing('exec: "docker": executable file not found in $PATH')
    ).toBe(true);
  });

  test('does not flag daemon or permission errors', () => {
    expect(
      isDockerCliMissing(
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
      )
    ).toBe(false);
    expect(
      isDockerCliMissing(
        'permission denied while trying to connect to the Docker daemon socket'
      )
    ).toBe(false);
    expect(isDockerCliMissing('docker info failed')).toBe(false);
  });
});

describe('assertLocalDockerAvailable', () => {
  test('reports a missing Docker CLI with an actionable message', async () => {
    const error = await assertLocalDockerAvailable(async () => ({
      stdout: '',
      stderr: '/bin/sh: 1: docker: not found',
      code: 127,
    })).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DockerUnavailableError);
    expect((error as DockerUnavailableError).code).toBe('docker_cli_missing');
    expect((error as Error).message).toContain(
      'The Docker CLI is not installed in this environment'
    );
    expect((error as Error).message).toContain(
      'Add this host as a Server over SSH instead, or run LazyBackup natively with Docker installed.'
    );
  });

  test('reports an unreachable daemon separately', async () => {
    const detail =
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock';
    const error = await assertLocalDockerAvailable(async () => ({
      stdout: '',
      stderr: detail,
      code: 1,
    })).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DockerUnavailableError);
    expect((error as DockerUnavailableError).code).toBe('docker_unreachable');
    expect((error as Error).message).toContain('Docker is not reachable on this host');
    expect((error as Error).message).toContain(detail);
  });

  test('resolves when docker info succeeds', async () => {
    await expect(
      assertLocalDockerAvailable(async () => ({ stdout: '', stderr: '', code: 0 }))
    ).resolves.toBeUndefined();
  });
});

const hasLocalDocker = await checkLocalDockerAvailable();

describe.skipIf(!hasLocalDocker)('local docker daemon', () => {
  test('listLocalDockerVolumes returns names', async () => {
    const volumes = await listLocalDockerVolumes();
    expect(Array.isArray(volumes)).toBe(true);
  });
});
