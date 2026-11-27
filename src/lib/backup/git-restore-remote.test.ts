import { describe, expect, mock, test , afterAll} from 'bun:test';
import fs, { createWriteStream } from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { pack } from 'tar-stream';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

const targetServer = {
  id: 's2',
  name: 'Dest',
  host: 'dest.example',
  port: 22,
  username: 'backup',
  authType: 'key',
  password: null,
  privateKey: null,
  sshKeyId: null,
  systemKeyPath: null,
};

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
        findMany: async () => [],
      },
      servers: { findFirst: async () => targetServer },
      s3Profiles: { findFirst: async () => null },
      peers: { findFirst: async () => null },
      peerDeletes: { findFirst: async () => null },
    },
  },
}));

const commands: string[] = [];
const pushedPaths: string[] = [];

const fakeSsh = {
  execCommand: async (command: string) => {
    commands.push(command);
    if (command.includes('mktemp -d')) {
      return { code: 0, stdout: '/tmp/lazybackup-git-TEST\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  },
  dispose: () => {},
};

mock.module('@/lib/ssh', () => ({
  connectToServer: async () => fakeSsh,
  resolvePrivateKeyForServer: async () => 'PRIVATE KEY',
  writeTemporarySshIdentityFile: async () => ({
    path: '/tmp/lazybackup-test-key',
    cleanup: async () => {},
  }),
  getBackupTransportCapabilities: async () => ({
    rsyncAvailable: false,
    scpAvailable: true,
  }),
  pushFileToRemote: async (options: { remotePath: string }) => {
    pushedPaths.push(options.remotePath);
    return { method: 'scp' as const, stdout: '', stderr: '' };
  },
  pullFileFromRemote: async () => {},
  resolvePrivateKeyForSshKeyId: async () => null,
}));

const { restoreGitRepoBackup } = await import('@/lib/backup');

async function writeGitArchive(archivePath: string): Promise<void> {
  const archive = pack();
  const writing = pipeline(archive, createGzip(), createWriteStream(archivePath));
  archive.entry({ type: 'directory', name: 'mirror.git/' });
  archive.entry(
    { type: 'file', name: 'mirror.git/HEAD' },
    'ref: refs/heads/main'
  );
  archive.finalize();
  await writing;
}

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  const freshSsh = await import(`../ssh/index.ts?real=${Date.now()}`);
  mock.module('@/lib/ssh', () => freshSsh);
});

describe('remote Git restore', () => {
  test('pushes to a mktemp dir instead of clobbering targetPath/git-mirror.tar.gz', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lbtest-git-remote-'));
    const archive = path.join(root, 'mirror.tar.gz');
    await writeGitArchive(archive);
    historyFixture = {
      id: 'h-git-remote',
      status: 'success',
      artifactPath: archive,
      backupConfig: {
        sourceType: 'git_repo',
        sourceKind: 'git',
        sourcePath: 'git-mirror',
        destinationKind: 'local',
      },
    };

    try {
      const result = await restoreGitRepoBackup('h-git-remote', {
        confirm: true,
        targetPath: '/srv/restore',
        targetServerId: 's2',
        allowRetarget: true,
      });

      expect(result.targetPath).toBe('/srv/restore');
      expect(pushedPaths).toEqual(['/tmp/lazybackup-git-TEST/git-mirror.tar.gz']);
      expect(pushedPaths[0]).not.toBe('/srv/restore/git-mirror.tar.gz');

      // Extract runs against the temp archive and the temp dir is removed.
      expect(
        commands.some(
          (command) =>
            command.includes("tar -xzf '/tmp/lazybackup-git-TEST/git-mirror.tar.gz'") &&
            command.includes("-C '/srv/restore'")
        )
      ).toBe(true);
      expect(
        commands.some((command) => command.includes("rm -rf '/tmp/lazybackup-git-TEST'"))
      ).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
