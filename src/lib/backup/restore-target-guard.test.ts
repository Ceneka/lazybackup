import { describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
      },
      peerDeletes: { findFirst: async () => null },
      servers: { findFirst: async () => null },
    },
  },
}));

const { restorePathBackup } = await import('@/lib/backup');

describe('local path restore target validation', () => {
  test('refuses to restore onto a system pseudo-filesystem path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-restore-target-'));
    const artifact = path.join(dir, 'artifact');
    await fs.mkdir(artifact);
    await fs.writeFile(path.join(artifact, 'file.txt'), 'payload');
    try {
      historyFixture = {
        id: 'h-target',
        status: 'success',
        artifactPath: artifact,
        backupConfig: {
          sourceType: 'path',
          sourceKind: 'local',
          sourcePath: path.join(dir, 'source'),
          destinationKind: 'local',
        },
      };

      await expect(
        restorePathBackup('h-target', {
          confirm: true,
          allowRetarget: true,
          targetPath: '/proc/lbtest-restedge-target',
        })
      ).rejects.toThrow(/refus|unsafe|not allowed/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
