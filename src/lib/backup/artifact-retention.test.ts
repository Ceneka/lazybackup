import { afterEach, describe, expect, mock, test } from 'bun:test';

type Row = { id: string; artifactPath: string | null };
let rows: Row[] = [];
let updatedValues: Record<string, unknown> | null = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findMany: async () => rows,
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          updatedValues = values;
          void condition;
        },
      }),
    }),
  },
}));

const {
  artifactPathMatchesDeletedPath,
  selectHistoryIdsRemovedByPaths,
  markArtifactsRemoved,
  ARTIFACT_REMOVED_BY_VERSION_RETENTION,
} = await import('./artifact-retention');

afterEach(() => {
  rows = [];
  updatedValues = null;
});

describe('artifactPathMatchesDeletedPath', () => {
  test('matches the exact artifact and files inside a deleted version folder', () => {
    expect(
      artifactPathMatchesDeletedPath('/backups/app/2026-08-07_23-15-01', '/backups/app/2026-08-07_23-15-01')
    ).toBe(true);
    expect(
      artifactPathMatchesDeletedPath(
        '/backups/app/2026-08-07_23-15-01/app.tar.gz',
        '/backups/app/2026-08-07_23-15-01/'
      )
    ).toBe(true);
    expect(
      artifactPathMatchesDeletedPath(
        's3://bucket/app/2026-08-07_23-15-01-2/dump.sql.gz',
        's3://bucket/app/2026-08-07_23-15-01-2'
      )
    ).toBe(true);
  });

  test('does not match sibling folders with a shared prefix', () => {
    expect(
      artifactPathMatchesDeletedPath(
        '/backups/app/2026-08-07_23-15-01-2/app.tar.gz',
        '/backups/app/2026-08-07_23-15-01'
      )
    ).toBe(false);
    expect(
      artifactPathMatchesDeletedPath('/backups/app-v2/x', '/backups/app')
    ).toBe(false);
  });
});

describe('selectHistoryIdsRemovedByPaths', () => {
  test('selects only runs whose artifact is gone', () => {
    expect(
      selectHistoryIdsRemovedByPaths(
        [
          { id: 'a', artifactPath: '/backups/v1' },
          { id: 'b', artifactPath: '/backups/v1/file.tar.gz' },
          { id: 'c', artifactPath: '/backups/v2' },
          { id: 'd', artifactPath: null },
        ],
        ['/backups/v1']
      )
    ).toEqual(['a', 'b']);
  });
});

describe('markArtifactsRemoved', () => {
  test('flags matching history rows with the retention reason', async () => {
    rows = [
      { id: 'keep', artifactPath: '/backups/app/2026-08-07_23-15-02' },
      { id: 'gone', artifactPath: '/backups/app/2026-08-07_23-15-01' },
      { id: 'gone-file', artifactPath: '/backups/app/2026-08-07_23-15-01/vol.tar.gz' },
    ];

    const count = await markArtifactsRemoved(
      'cfg-1',
      ['/backups/app/2026-08-07_23-15-01'],
      ARTIFACT_REMOVED_BY_VERSION_RETENTION
    );

    expect(count).toBe(2);
    expect(updatedValues).toEqual({
      artifactRemoved: true,
      artifactRemovedReason: ARTIFACT_REMOVED_BY_VERSION_RETENTION,
    });
  });

  test('does nothing when no paths were deleted', async () => {
    rows = [{ id: 'a', artifactPath: '/backups/app' }];
    expect(await markArtifactsRemoved('cfg-1', [], 'x')).toBe(0);
    expect(updatedValues).toBeNull();
  });
});
