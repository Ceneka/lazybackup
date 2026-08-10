import { describe, expect, test } from 'bun:test';
import {
  canRestoreDockerVolumeBackup,
  restoreBlockedReason,
} from './restore-eligibility';

describe('canRestoreDockerVolumeBackup', () => {
  test('allows successful local docker volume with artifact', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'docker_volume',
        destinationKind: 'local',
        artifactPath: '/backups/vol.tar.gz',
      })
    ).toBe(true);
  });

  test('defaults missing destinationKind to local', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'docker_volume',
        artifactPath: '/backups/vol.tar.gz',
      })
    ).toBe(true);
  });

  test('blocks remote destination even with artifact path', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'docker_volume',
        destinationKind: 'server',
        artifactPath: '/remote/path/vol.tar.gz',
      })
    ).toBe(false);
  });

  test('blocks path sources and non-success', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'path',
        artifactPath: '/backups/dir',
      })
    ).toBe(false);
    expect(
      canRestoreDockerVolumeBackup({
        status: 'failed',
        sourceType: 'docker_volume',
        artifactPath: '/backups/vol.tar.gz',
      })
    ).toBe(false);
  });
});

describe('restoreBlockedReason', () => {
  test('explains remote destination', () => {
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'docker_volume',
        destinationKind: 'server',
        artifactPath: '/x',
      })
    ).toMatch(/this host/i);
  });

  test('returns null for non-volume backups', () => {
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'path',
        artifactPath: '/x',
      })
    ).toBeNull();
  });
});
