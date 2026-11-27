import { beforeEach, describe, expect, mock, test , afterAll} from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

process.env.NEXT_RUNTIME = 'nodejs';

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      ageKeys: {
        findMany: async () => [{ identity: 'AGE-SECRET-KEY-1TEST' }],
      },
      peerDeletes: { findFirst: async () => null },
      servers: { findFirst: async () => null },
      s3Profiles: { findFirst: async () => null },
      peers: { findFirst: async () => null },
    },
  },
}));

const actualS3 = await import('@/lib/s3');
mock.module('@/lib/s3', () => ({
  ...actualS3,
  downloadFile: async () => {
    const error = Object.assign(new Error('The specified key does not exist.'), {
      name: 'NoSuchKey',
    });
    throw error;
  },
}));

const actualFiles = await import('@/lib/crypto/files');
mock.module('@/lib/crypto/files', () => ({
  ...actualFiles,
  decryptLocalFile: async () => {
    throw new Error('age: no identity matched any recipient');
  },
}));

const { resolveLocalRestoreArtifact, resolveLocalPathRestoreTree } = await import(
  './index'
);

const TEMP_PREFIXES = [
  'lazybackup-restore-',
  'lazybackup-decrypt-',
  'lazybackup-path-restore-',
  'lazybackup-path-decrypt-',
  'lazybackup-path-extract-',
];

async function restoreTempDirs(): Promise<string[]> {
  const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
    )
    .map((entry) => entry.name)
    .sort();
}

const profile = {
  id: 's3-1',
  name: 'minio',
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'backups',
  accessKeyId: 'x',
  secretAccessKey: 'y',
  forcePathStyle: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let baseline: string[] = [];

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  const freshFiles = await import(`../crypto/files.ts?real=${Date.now()}`);
  mock.module('@/lib/crypto/files', () => freshFiles);
  const freshS3 = await import(`../s3/index.ts?real=${Date.now()}`);
  mock.module('@/lib/s3', () => freshS3);
});

beforeEach(async () => {
  baseline = await restoreTempDirs();
});

describe('restore temp directory cleanup', () => {
  test('a failed S3 download leaves no ciphertext temp dir behind', async () => {
    await expect(
      resolveLocalRestoreArtifact({
        artifactPath: 's3://backups/app/vol.tar.gz.age',
        destinationKind: 's3',
        destinationS3Profile: profile,
      })
    ).rejects.toThrow('Backup artifact missing from S3: s3://backups/app/vol.tar.gz.age');

    expect(await restoreTempDirs()).toEqual(baseline);
  });

  test('a failed path download leaves no tree temp dir behind', async () => {
    await expect(
      resolveLocalPathRestoreTree({
        artifactPath: 's3://backups/app/tree.tar.gz',
        destinationKind: 's3',
        destinationS3Profile: profile,
      })
    ).rejects.toThrow(/Backup artifact missing from S3/);

    expect(await restoreTempDirs()).toEqual(baseline);
  });

  test('failed age decryption removes plaintext/ciphertext temp dirs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-age-input-'));
    const artifact = path.join(dir, 'vol.tar.gz.age');
    await fs.writeFile(artifact, 'ciphertext');
    try {
      await expect(
        resolveLocalRestoreArtifact({
          artifactPath: artifact,
          destinationKind: 'local',
        })
      ).rejects.toThrow(
        'None of the keys in your vault (or recovery keys) can decrypt this backup: vol.tar.gz.age'
      );

      expect(await restoreTempDirs()).toEqual(baseline);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
