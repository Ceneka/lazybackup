import { describe, expect, test } from 'bun:test';
import {
  canDownloadBackup,
  canRestoreBackup,
  canRestoreDockerVolumeBackup,
  contentDispositionAttachment,
  downloadFilenameForLocalPath,
  downloadFilenameFromArtifactPath,
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

  test('allows successful path tree with local artifact', () => {
    expect(
      canRestoreBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'local',
        artifactPath: '/backups/tree',
      })
    ).toBe(true);
  });

  test('allows path restore from S3 or peer destinations', () => {
    expect(
      canRestoreBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 's3',
        artifactPath: 's3://bucket/prefix/',
      })
    ).toBe(true);
    expect(
      canRestoreBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'peer',
        artifactPath: 'peer://p1/obj.tar.gz.age',
      })
    ).toBe(true);
  });

  test('blocks path restore when destination is remote SSH', () => {
    expect(
      canRestoreBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'server',
        artifactPath: '/remote/tree',
      })
    ).toBe(false);
  });

  test('blocks non-success', () => {
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

  test('explains remote server destination for path', () => {
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'server',
        artifactPath: '/x',
      })
    ).toMatch(/SSH destinations|this host|S3|bro/i);
  });

  test('returns null for instance meta-backups', () => {
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'lazybackup_instance',
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

  test('uses path wording for failed path restore', () => {
    expect(
      restoreBlockedReason({
        status: 'failed',
        sourceType: 'path',
        destinationKind: 'local',
        artifactPath: '/x',
      })
    ).toMatch(/path/);
  });

  test('blocks restore when the peer artifact was removed by retention', () => {
    expect(
      canRestoreBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'peer',
        artifactPath: 'peer://p1/obj.tar.gz.age',
        artifactRemoved: true,
      })
    ).toBe(false);
    expect(
      restoreBlockedReason({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'peer',
        artifactPath: 'peer://p1/obj.tar.gz.age',
        artifactRemoved: true,
      })
    ).toBe('artifact removed by retention');
  });
});

describe('download filename helpers', () => {
  test('takes basename from local, s3, and peer paths', () => {
    expect(downloadFilenameFromArtifactPath('/backups/app.sql.gz')).toBe(
      'app.sql.gz'
    );
    expect(
      downloadFilenameFromArtifactPath('s3://bucket/prefix/vol.tar.gz.age')
    ).toBe('vol.tar.gz.age');
    expect(
      downloadFilenameFromArtifactPath('peer://abc/obj.tar.gz.age')
    ).toBe('obj.tar.gz.age');
  });

  test('strips trailing slashes on directory artifacts', () => {
    expect(downloadFilenameFromArtifactPath('/backups/tree/')).toBe('tree');
  });

  test('adds tar.gz for directories', () => {
    expect(downloadFilenameForLocalPath('/backups/tree', true)).toBe(
      'tree.tar.gz'
    );
    expect(downloadFilenameForLocalPath('/backups/app.tar.gz', false)).toBe(
      'app.tar.gz'
    );
  });

  test('builds Content-Disposition and strips quotes', () => {
    expect(contentDispositionAttachment('app.sql.gz')).toBe(
      'attachment; filename="app.sql.gz"'
    );
    expect(contentDispositionAttachment('weird"name.sql.gz')).toBe(
      'attachment; filename="weirdname.sql.gz"'
    );
  });

  test('canDownloadBackup matches restore eligibility', () => {
    expect(
      canDownloadBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'local',
        artifactPath: '/backups/tree',
      })
    ).toBe(true);
    expect(
      canDownloadBackup({
        status: 'success',
        sourceType: 'path',
        destinationKind: 'server',
        artifactPath: '/remote/tree',
      })
    ).toBe(false);
  });
});
