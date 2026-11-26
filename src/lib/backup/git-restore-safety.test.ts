import { describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { pack } from 'tar-stream';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
        findMany: async () => [],
      },
      peerDeletes: { findFirst: async () => null },
      servers: { findFirst: async () => null },
      s3Profiles: { findFirst: async () => null },
      peers: { findFirst: async () => null },
    },
  },
}));

const { restoreGitRepoBackup } = await import('@/lib/backup');

async function writeTarGz(
  archivePath: string,
  entries: Array<{ header: Parameters<ReturnType<typeof pack>['entry']>[0]; body?: string }>
): Promise<void> {
  const archive = pack();
  const writing = pipeline(archive, createGzip(), createWriteStream(archivePath));
  for (const entry of entries) {
    archive.entry(entry.header, entry.body ?? '');
  }
  archive.finalize();
  await writing;
}

function gitHistory(artifactPath: string): Row {
  return {
    id: 'h-git',
    status: 'success',
    artifactPath,
    backupConfig: {
      sourceType: 'git_repo',
      sourceKind: 'git',
      sourcePath: 'https://example.com/repo.git',
      destinationKind: 'local',
    },
  };
}

describe('git mirror restore archive safety', () => {
  test('rejects an archive with an absolute symlink before extracting it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-git-restore-'));
    const archive = path.join(dir, 'mirror.tar.gz');
    const target = path.join(dir, 'out');
    try {
      await writeTarGz(archive, [
        { header: { type: 'directory', name: 'mirror.git/' } },
        { header: { type: 'file', name: 'mirror.git/HEAD' }, body: 'ref: refs/heads/main' },
        { header: { type: 'symlink', name: 'escape', linkname: '/etc/passwd' } },
        { header: { type: 'file', name: 'escape/owned' }, body: 'pwn' },
      ]);
      historyFixture = gitHistory(archive);

      await expect(
        restoreGitRepoBackup('h-git', { confirm: true, targetPath: target })
      ).rejects.toThrow(/unsafe|symlink|absolute|tar/i);

      // Nothing may be extracted when the archive is unsafe.
      const leaked = await fs.stat(path.join(target, 'escape')).catch(() => null);
      expect(leaked).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('still restores an ordinary bare mirror archive', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-git-restore-'));
    const archive = path.join(dir, 'mirror.tar.gz');
    const target = path.join(dir, 'out');
    try {
      await writeTarGz(archive, [
        { header: { type: 'directory', name: 'mirror.git/' } },
        { header: { type: 'file', name: 'mirror.git/HEAD' }, body: 'ref: refs/heads/main' },
        { header: { type: 'file', name: 'mirror.git/config' }, body: '[core]' },
      ]);
      historyFixture = gitHistory(archive);

      const result = await restoreGitRepoBackup('h-git', {
        confirm: true,
        targetPath: target,
      });
      expect(result.targetPath).toBe(target);
      const head = await fs.readFile(path.join(target, 'mirror.git', 'HEAD'), 'utf8');
      expect(head).toContain('refs/heads/main');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
