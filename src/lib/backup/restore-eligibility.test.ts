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

  test('blocks remote server destination even with artifact path', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'docker_volume',
        destinationKind: 'server',
        artifactPath: '/remote/path/vol.tar.gz',
      })
    ).toBe(false);
  });

  test('allows S3 destination with artifact path', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'database',
        destinationKind: 's3',
        artifactPath: 's3://bucket/prefix/app.sql.gz',
      })
    ).toBe(true);
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

  test('allows successful database dump with local artifact', () => {
    expect(
      canRestoreDockerVolumeBackup({
        status: 'success',
        sourceType: 'database',
        destinationKind: 'local',
        artifactPath: '/backups/app.sql.gz',
      })
    ).toBe(true);
  });
});

describe('restoreBlockedReason', () => {
  test('explains remote server destination', () => {
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'docker_volume',
        destinationKind: 'server',
        artifactPath: '/x',
      })
    ).toMatch(/S3|this host|bro/i);
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

  test('uses database wording for failed database restore', () => {
    expect(
      restoreBlockedReason({
        status: 'failed',
        sourceType: 'database',
        destinationKind: 'local',
        artifactPath: '/x',
      })
    ).toMatch(/database/);
  });
});
