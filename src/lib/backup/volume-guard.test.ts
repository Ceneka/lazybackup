import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import type { NodeSSH } from 'node-ssh';
import {
  packDockerVolume,
  packDockerVolumeLocal,
  type DockerShellRunner,
} from '@/lib/docker/volumes';
import { LOG_SECTION, combineBackupLog } from '@/lib/backup/log-format';
import { shouldRunPreBackupCommands, transferLogMethod } from './index';

process.env.NEXT_RUNTIME = 'nodejs';

type ShellResult = { stdout: string; stderr: string; code: number };
type RemoteResult = { stdout: string; stderr: string; code: number };

const NO_SUCH_VOLUME = 'Error response from daemon: No such volume: ghost';

function fakeRemoteSsh(options: { exists: boolean; calls: string[] }): NodeSSH {
  const execCommand = async (command: string): Promise<RemoteResult> => {
    options.calls.push(command);
    if (command.includes('docker info')) return { stdout: 'ok', stderr: '', code: 0 };
    if (command.includes('docker volume inspect')) {
      return options.exists
        ? { stdout: '[{}]', stderr: '', code: 0 }
        : { stdout: '', stderr: NO_SUCH_VOLUME, code: 1 };
    }
    if (command.includes('mktemp -d')) {
      return { stdout: '/tmp/lazybackup-docker-test\n', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  return { execCommand } as unknown as NodeSSH;
}

function fakeLocalShell(options: {
  exists: boolean;
  calls: string[];
}): DockerShellRunner {
  return async (command): Promise<ShellResult> => {
    options.calls.push(command);
    if (command.includes('docker info')) return { stdout: 'ok', stderr: '', code: 0 };
    if (command.includes('docker run')) return { stdout: '', stderr: '', code: 0 };
    if (command.includes('docker volume inspect')) {
      return options.exists
        ? { stdout: '[{}]', stderr: '', code: 0 }
        : { stdout: '', stderr: NO_SUCH_VOLUME, code: 1 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };
}

function packCommands(calls: string[]): string[] {
  return calls.filter((command) => command.includes('docker run'));
}

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('docker volume pack guard: local host', () => {
  test('missing volume throws before any docker run', async () => {
    const calls: string[] = [];
    const runShell = fakeLocalShell({ exists: false, calls });

    await expect(packDockerVolumeLocal('ghost', [], runShell)).rejects.toThrow(
      'Docker volume "ghost" was not found on this host. Backups are not created for missing volumes.'
    );

    expect(calls.some((command) => command.includes('docker volume inspect'))).toBe(true);
    // `docker run -v/--mount` would auto-create the volume and pack an empty dir.
    expect(packCommands(calls)).toEqual([]);
    expect(calls.some((command) => command.includes('mktemp'))).toBe(false);
  });

  test('existing volume still packs with a non-creating --mount', async () => {
    const calls: string[] = [];
    const runShell = fakeLocalShell({ exists: true, calls });

    const packed = await packDockerVolumeLocal('vol', [], runShell);
    tmpDirs.push(packed.localTmpDir);

    expect(packed.localArchivePath.endsWith('vol.tar.gz')).toBe(true);
    const packs = packCommands(calls);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toContain(
      "--mount 'type=volume,source=vol,target=/data,volume-nocopy'"
    );
    expect(packs[0]).toContain("docker volume inspect 'vol' >/dev/null &&");
    expect(packs[0]).toContain('-C /data .');
  });
});

describe('docker volume pack guard: source server', () => {
  test('missing volume throws before any docker run', async () => {
    const calls: string[] = [];
    const ssh = fakeRemoteSsh({ exists: false, calls });

    await expect(packDockerVolume(ssh, 'ghost', [], 'src-1')).rejects.toThrow(
      'Docker volume "ghost" was not found on src-1. Backups are not created for missing volumes.'
    );

    expect(packCommands(calls)).toEqual([]);
    expect(calls.some((command) => command.includes('mktemp'))).toBe(false);
  });

  test('existing volume still packs', async () => {
    const calls: string[] = [];
    const ssh = fakeRemoteSsh({ exists: true, calls });

    const packed = await packDockerVolume(ssh, 'vol', [], 'src-1');

    expect(packed.remoteArchivePath).toBe('/tmp/lazybackup-docker-test/vol.tar.gz');
    expect(packCommands(calls)).toHaveLength(1);
  });
});

describe('volume transfer log header', () => {
  test('volume methods use the Docker section header, not rsync', () => {
    expect(transferLogMethod('docker-file-local')).toBe('docker');
    expect(transferLogMethod('docker-file-local-age')).toBe('docker');
    expect(transferLogMethod('docker-relay')).toBe('docker');
    expect(transferLogMethod('docker-s3')).toBe('docker');

    const log = combineBackupLog(
      '',
      'Volume: data\nArchive: data.tar.gz\nSize: 123 bytes',
      transferLogMethod('docker-file-local')
    );

    expect(log.startsWith(LOG_SECTION.transferDocker)).toBe(true);
    expect(log).not.toContain(LOG_SECTION.transferRsync);
    expect(log).toContain('Volume: data');
    expect(log).toContain('Archive: data.tar.gz');
    expect(log).toContain('Size: 123 bytes');
  });

  test('path methods keep the rsync section header', () => {
    expect(transferLogMethod('local-rsync')).toBe('local-rsync');
    expect(transferLogMethod('push-rsync')).toBe('push-rsync');

    const log = combineBackupLog(
      '',
      'Number of files: 1',
      transferLogMethod('local-rsync')
    );

    expect(log.startsWith(LOG_SECTION.transferRsync)).toBe(true);
    expect(log).not.toContain(LOG_SECTION.transferDocker);
  });
});

describe('pre-backup command skip matrix', () => {
  test('S3 and Git sources never run pre-backup commands', () => {
    expect(shouldRunPreBackupCommands('s3', 'path')).toBe(false);
    expect(shouldRunPreBackupCommands('git', 'git_repo')).toBe(false);
  });

  test('lazybackup_instance never runs stale pre-backup commands', () => {
    expect(shouldRunPreBackupCommands('local', 'lazybackup_instance')).toBe(false);
  });

  test('path, docker_volume, and database sources still run them', () => {
    for (const sourceKind of ['local', 'server'] as const) {
      expect(shouldRunPreBackupCommands(sourceKind, 'path')).toBe(true);
      expect(shouldRunPreBackupCommands(sourceKind, 'docker_volume')).toBe(true);
      expect(shouldRunPreBackupCommands(sourceKind, 'database')).toBe(true);
    }
  });
});
