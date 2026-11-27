import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { encryptFileWithPassphrase } from '@/lib/crypto/age';
import { exportVaultSecrets } from '@/lib/crypto/keys';
import { BunRuntimeUnavailableError, snapshotSqliteLocal } from '@/lib/database';
import { db } from '@/lib/db';
import { resolveSqliteFilePath } from '@/lib/db/sqlite-path';

const execFileAsync = promisify(execFile);

export { resolveSqliteFilePath } from '@/lib/db/sqlite-path';

export type InstanceSnapshotFallback = 'wal-copy' | null;

export type InstanceExportResult = {
  localPath: string;
  archiveName: string;
  tmpDir: string;
  passphraseWrapped: boolean;
  snapshotFallback: InstanceSnapshotFallback;
};

/**
 * Copy a live SQLite database together with the WAL sidecars that carry
 * committed data. `data.db-wal` holds commits that no checkpoint has written
 * to the main file yet; copying only `data.db` silently rolls the backup back.
 * `-shm` is copied when present so SQLite can open the bundle copy without
 * rebuilding the WAL index. Best-effort: prefer snapshotSqliteLocal when Bun
 * is available.
 */
export async function copySqliteWithWalSidecars(
  dbPath: string,
  targetPath: string
): Promise<void> {
  const source = dbPath.trim();
  await fs.copyFile(source, targetPath);
  // shm before wal: a copied index must never describe more frames than the
  // copied WAL contains.
  for (const suffix of ['-shm', '-wal']) {
    await fs.copyFile(`${source}${suffix}`, `${targetPath}${suffix}`).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    });
  }
}

/**
 * Snapshot the live instance database into the bundle. Bun's VACUUM INTO is
 * transactionally consistent; when the app runs on Node without a Bun binary,
 * fall back to a WAL-safe copy instead of failing the whole backup (or
 * silently dropping committed frames).
 */
export async function snapshotInstanceDatabase(
  dbPath: string,
  targetPath: string
): Promise<InstanceSnapshotFallback> {
  try {
    await snapshotSqliteLocal(dbPath, targetPath);
    return null;
  } catch (error) {
    if (!(error instanceof BunRuntimeUnavailableError)) throw error;
    await copySqliteWithWalSidecars(dbPath, targetPath);
    return 'wal-copy';
  }
}

/**
 * Pack LazyBackup instance data: SQLite DB, age vault secrets, SSH key rows, manifest.
 * Optional passphrase wraps the tarball with age (not the instance age key).
 */
export async function packLazybackupInstance(options?: {
  passphrase?: string | null;
  archiveBaseName?: string;
}): Promise<InstanceExportResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-instance-'));
  try {
    const staging = path.join(tmpDir, 'bundle');
    await fs.mkdir(staging, { recursive: true });

    const dbPath = resolveSqliteFilePath();
    await fs.access(dbPath);
    // A plain copyFile of a WAL-mode database misses every commit still in
    // the -wal file (and can catch a checkpoint mid-write). VACUUM INTO gives
    // a consistent snapshot with all committed data; without Bun, keep the
    // sidecars with the copy so committed frames survive.
    const snapshotFallback = await snapshotInstanceDatabase(
      dbPath,
      path.join(staging, 'data.db')
    );

    const vault = await exportVaultSecrets();
    await fs.writeFile(
      path.join(staging, 'age-vault.json'),
      JSON.stringify(vault, null, 2),
      'utf8'
    );

    const sshRows = await db.query.sshKeys.findMany();
    await fs.writeFile(
      path.join(staging, 'ssh-keys.json'),
      JSON.stringify(
        sshRows.map((k) => ({
          id: k.id,
          name: k.name,
          privateKeyPath: k.privateKeyPath,
          publicKeyPath: k.publicKeyPath,
          privateKeyContent: k.privateKeyContent,
        })),
        null,
        2
      ),
      'utf8'
    );

    const restoreNote =
      'Restore manually: stop LazyBackup, replace SQLite, import age keys, restart. Passphrase-wrapped archives use age -d.';
    const manifest = {
      format: 'lazybackup-instance-v1',
      createdAt: new Date().toISOString(),
      includes: ['data.db', 'age-vault.json', 'ssh-keys.json'],
      note:
        snapshotFallback === 'wal-copy'
          ? `${restoreNote} Bun was unavailable: data.db was copied with its -wal/-shm sidecars (committed data may live in data.db-wal), keep them together when restoring.`
          : restoreNote,
    };
    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    const baseName = options?.archiveBaseName || 'lazybackup-instance';
    const tarName = `${baseName}.tar.gz`;
    const tarPath = path.join(tmpDir, tarName);

    await execFileAsync('tar', ['-czf', tarPath, '-C', staging, '.'], {
      maxBuffer: 50 * 1024 * 1024,
    });
    // Contains the SQLite DB, age identities, and SSH keys: never group/world-readable.
    await fs.chmod(tarPath, 0o600);

    const passphrase = options?.passphrase?.trim();
    if (passphrase) {
      const encName = `${tarName}.age`;
      const encPath = path.join(tmpDir, encName);
      // Streams the tar through age; a bloated instance DB makes it GBs.
      await encryptFileWithPassphrase(tarPath, encPath, passphrase);
      await fs.chmod(encPath, 0o600);
      await fs.unlink(tarPath).catch(() => undefined);
      return {
        localPath: encPath,
        archiveName: encName,
        tmpDir,
        passphraseWrapped: true,
        snapshotFallback,
      };
    }

    return {
      localPath: tarPath,
      archiveName: tarName,
      tmpDir,
      passphraseWrapped: false,
      snapshotFallback,
    };
  } catch (error) {
    // Never leave a plaintext DB / age vault / SSH keys in /tmp on failure.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Validate instance export prerequisites. */
export async function assertInstanceExportReadable(): Promise<{ dbPath: string }> {
  const dbPath = resolveSqliteFilePath();
  await fs.access(dbPath);
  return { dbPath };
}
