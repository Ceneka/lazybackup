import { describe, expect, test } from 'bun:test';
import {
  buildRestoreSnapshot,
  effectiveRestoreConfig,
  parseRestoreSnapshot,
  restoreDefaultsFromSnapshot,
  snapshotDiffersFromConfig,
} from './restore-snapshot';

const baseConfig = {
  sourceKind: 'server' as const,
  serverId: 'srv-1',
  sourceType: 'path' as const,
  sourcePath: '/srv/app',
  destinationKind: 'local' as const,
  destinationPath: '/backups/app',
  enableEncryption: false,
  enableVersioning: true,
};

describe('buildRestoreSnapshot', () => {
  test('captures restore-relevant fields and derives db/volume names', () => {
    const capturedAt = new Date('2026-08-07T23:15:01.000Z');
    expect(
      buildRestoreSnapshot(
        {
          ...baseConfig,
          sourceType: 'database',
          sourcePath: 'appdb',
          dbEngine: 'postgres',
          destinationKind: 's3',
          destinationS3ProfileId: 's3-1',
          destinationPath: 'backups/app',
          enableEncryption: true,
        },
        { capturedAt }
      )
    ).toMatchObject({
      version: 1,
      capturedAt: capturedAt.toISOString(),
      sourceKind: 'server',
      serverId: 'srv-1',
      sourceType: 'database',
      sourcePath: 'appdb',
      dbEngine: 'postgres',
      dbName: 'appdb',
      volumeName: null,
      destinationKind: 's3',
      destinationS3ProfileId: 's3-1',
      destinationPath: 'backups/app',
      enableEncryption: true,
      enableVersioning: true,
    });
  });

  test('volume snapshots keep the volume name', () => {
    const snapshot = buildRestoreSnapshot({
      ...baseConfig,
      sourceKind: 'local',
      serverId: null,
      sourceType: 'docker_volume',
      sourcePath: 'app_data',
    });
    expect(snapshot.volumeName).toBe('app_data');
    expect(snapshot.dbName).toBeNull();
  });
});

describe('parseRestoreSnapshot', () => {
  test('round-trips JSON and ignores invalid/legacy values', () => {
    const snapshot = buildRestoreSnapshot(baseConfig);
    expect(parseRestoreSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseRestoreSnapshot('')).toBeNull();
    expect(parseRestoreSnapshot('{not json')).toBeNull();
    expect(parseRestoreSnapshot({ version: 99 })).toBeNull();
    expect(parseRestoreSnapshot(null)).toBeNull();
  });
});

describe('effectiveRestoreConfig', () => {
  test('legacy rows fall back to the live config', () => {
    const effective = effectiveRestoreConfig(null, baseConfig);
    expect(effective.snapshot).toBeNull();
    expect(effective.sourcePath).toBe('/srv/app');
    expect(effective.destinationPath).toBe('/backups/app');
    expect(effective.sourceKind).toBe('server');
  });

  test('snapshot wins over an edited live config', () => {
    const snapshot = buildRestoreSnapshot(baseConfig);
    const effective = effectiveRestoreConfig(snapshot, {
      ...baseConfig,
      sourcePath: '/srv/app-v2',
      serverId: 'srv-2',
      destinationKind: 'server',
      destinationServerId: 'srv-2',
      destinationPath: '/backups/v2',
    });
    expect(effective.sourcePath).toBe('/srv/app');
    expect(effective.serverId).toBe('srv-1');
    expect(effective.destinationKind).toBe('local');
    expect(effective.destinationPath).toBe('/backups/app');
  });
});

describe('restoreDefaultsFromSnapshot (contract C5)', () => {
  test('fills path defaults and reports changed config', () => {
    const snapshot = buildRestoreSnapshot(baseConfig);
    expect(
      restoreDefaultsFromSnapshot(snapshot, {
        ...baseConfig,
        sourcePath: '/srv/app-v2',
      })
    ).toEqual({
      targetPath: '/srv/app',
      targetServerId: 'srv-1',
      databaseName: null,
      volumeName: null,
      configChangedSinceRun: true,
    });
  });

  test('returns null for legacy rows without a snapshot', () => {
    expect(restoreDefaultsFromSnapshot(null, baseConfig)).toBeNull();
  });

  test('database and volume defaults use the snapshotted names', () => {
    const dbSnapshot = buildRestoreSnapshot({
      ...baseConfig,
      sourceType: 'database',
      sourcePath: 'appdb',
      dbEngine: 'postgres',
    });
    expect(restoreDefaultsFromSnapshot(dbSnapshot, baseConfig)?.databaseName).toBe(
      'appdb'
    );

    const volumeSnapshot = buildRestoreSnapshot({
      ...baseConfig,
      sourceKind: 'local',
      serverId: null,
      sourceType: 'docker_volume',
      sourcePath: 'app_data',
    });
    expect(restoreDefaultsFromSnapshot(volumeSnapshot, baseConfig)?.volumeName).toBe(
      'app_data'
    );
  });

  test('Git snapshots do not expose the repo URL as a target path', () => {
    const snapshot = buildRestoreSnapshot({
      ...baseConfig,
      sourceKind: 'git',
      serverId: null,
      sourceType: 'git_repo',
      sourcePath: 'git-mirror',
    });
    const defaults = restoreDefaultsFromSnapshot(snapshot, {
      ...baseConfig,
      sourceKind: 'git',
    });
    expect(defaults?.targetPath).toBeNull();
    expect(defaults?.targetServerId).toBeNull();
  });

  test('detects only restore-relevant edits', () => {
    const snapshot = buildRestoreSnapshot(baseConfig);
    expect(snapshotDiffersFromConfig(snapshot, baseConfig)).toBe(false);
    expect(
      snapshotDiffersFromConfig(snapshot, { ...baseConfig, name: 'renamed' } as never)
    ).toBe(false);
    expect(
      snapshotDiffersFromConfig(snapshot, { ...baseConfig, enableVersioning: false })
    ).toBe(true);
  });
});
