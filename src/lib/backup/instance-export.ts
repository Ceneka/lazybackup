import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { encryptFileWithPassphrase } from '@/lib/crypto/age';
import { exportVaultSecrets } from '@/lib/crypto/keys';
import { db } from '@/lib/db';
import { resolveSqliteFilePath } from '@/lib/db/sqlite-path';

const execFileAsync = promisify(execFile);

export { resolveSqliteFilePath } from '@/lib/db/sqlite-path';

export type InstanceExportResult = {
  localPath: string;
  archiveName: string;
  tmpDir: string;
  passphraseWrapped: boolean;
};

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
    await fs.copyFile(dbPath, path.join(staging, 'data.db'));

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

    const manifest = {
      format: 'lazybackup-instance-v1',
      createdAt: new Date().toISOString(),
      includes: ['data.db', 'age-vault.json', 'ssh-keys.json'],
      note: 'Restore manually: stop LazyBackup, replace SQLite, import age keys, restart. Passphrase-wrapped archives use age -d.',
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
      await encryptFileWithPassphrase(tarPath, encPath, passphrase);
      await fs.chmod(encPath, 0o600);
      await fs.unlink(tarPath).catch(() => undefined);
      return {
        localPath: encPath,
        archiveName: encName,
        tmpDir,
        passphraseWrapped: true,
      };
    }

    return {
      localPath: tarPath,
      archiveName: tarName,
      tmpDir,
      passphraseWrapped: false,
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
