import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {
  ageEncryptedFileName,
  encryptLocalFile,
} from '@/lib/crypto/files';
import { requireAgeRecipient } from '@/lib/crypto/keys';

const execFileAsync = promisify(execFile);

/**
 * If encryption is enabled, encrypt a local file and return the `.age` path + name.
 * Caller owns cleanup of returned `encryptedPath` when it differs from input.
 */
export async function maybeEncryptLocalArtifact(options: {
  enableEncryption: boolean;
  localPath: string;
  archiveName: string;
}): Promise<{
  localPath: string;
  archiveName: string;
  encrypted: boolean;
  /** Temp encrypted file to delete after land (null if not encrypted or in-place sibling kept by caller) */
  cleanupPath: string | null;
}> {
  if (!options.enableEncryption) {
    return {
      localPath: options.localPath,
      archiveName: options.archiveName,
      encrypted: false,
      cleanupPath: null,
    };
  }

  const recipient = await requireAgeRecipient();
  const encName = ageEncryptedFileName(options.archiveName);
  const encPath = path.join(path.dirname(options.localPath), encName);
  await encryptLocalFile(options.localPath, recipient, encPath);
  return {
    localPath: encPath,
    archiveName: encName,
    encrypted: true,
    cleanupPath: encPath,
  };
}

/** Tar a local directory (or file) to a .tar.gz then optionally encrypt. */
export async function packLocalPathArchive(options: {
  sourcePath: string;
  archiveBaseName: string;
  enableEncryption: boolean;
  excludePatterns?: string[];
}): Promise<{
  localPath: string;
  archiveName: string;
  encrypted: boolean;
  tmpDir: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-enc-'));
  const tarName = `${options.archiveBaseName}.tar.gz`;
  const tarPath = path.join(tmpDir, tarName);

  const excludeArgs: string[] = [];
  for (const pattern of options.excludePatterns || []) {
    const p = pattern.trim();
    if (p) excludeArgs.push(`--exclude=${p}`);
  }

  const resolved = path.resolve(options.sourcePath);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);

  await execFileAsync(
    'tar',
    ['-czf', tarPath, ...excludeArgs, '-C', parent, base],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  if (!options.enableEncryption) {
    return {
      localPath: tarPath,
      archiveName: tarName,
      encrypted: false,
      tmpDir,
    };
  }

  const encrypted = await maybeEncryptLocalArtifact({
    enableEncryption: true,
    localPath: tarPath,
    archiveName: tarName,
  });

  return {
    localPath: encrypted.localPath,
    archiveName: encrypted.archiveName,
    encrypted: true,
    tmpDir,
  };
}
