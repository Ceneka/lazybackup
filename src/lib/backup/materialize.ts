import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { maybeEncryptLocalArtifact, packLocalPathArchive } from '@/lib/backup/encrypt-artifact';
import {
  getBackupTransportCapabilities,
  pullFileFromRemote,
  resolvePrivateKeyForServer,
  writeTemporarySshIdentityFile,
  type Server,
} from '@/lib/ssh';
import type { NodeSSH } from 'node-ssh';

/**
 * Ensure we have a local (optionally encrypted) file ready to land.
 * Pulls from remote when needed.
 */
export async function materializeLocalArtifact(options: {
  enableEncryption: boolean;
  archiveName: string;
  /** Local path to packed file, if already local */
  localPath?: string | null;
  /** Remote path when packed on a server */
  remotePath?: string | null;
  sourceServer?: Server | null;
  sourceSsh?: NodeSSH | null;
}): Promise<{
  localPath: string;
  archiveName: string;
  encrypted: boolean;
  tmpPaths: string[];
  cleanupIdentity?: () => Promise<void>;
}> {
  const tmpPaths: string[] = [];
  let cleanupIdentity: (() => Promise<void>) | undefined;
  let localPath = options.localPath || null;

  if (!localPath) {
    if (!options.remotePath || !options.sourceServer || !options.sourceSsh) {
      throw new Error('Cannot materialize artifact: missing remote path or source server');
    }
    const privateKey = await resolvePrivateKeyForServer(options.sourceServer);
    const { path: keyPath, cleanup } = await writeTemporarySshIdentityFile(privateKey);
    cleanupIdentity = cleanup;
    const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(
      options.sourceSsh
    );
    localPath = path.join(
      os.tmpdir(),
      `lazybackup-mat-${Date.now()}-${path.basename(options.archiveName)}`
    );
    await pullFileFromRemote({
      remotePath: options.remotePath,
      localPath,
      username: options.sourceServer.username,
      host: options.sourceServer.host,
      port: options.sourceServer.port,
      identityKeyPath: keyPath,
      rsyncAvailable,
      scpAvailable,
    });
    tmpPaths.push(localPath);
  }

  const encrypted = await maybeEncryptLocalArtifact({
    enableEncryption: options.enableEncryption,
    localPath,
    archiveName: options.archiveName,
  });
  if (encrypted.cleanupPath && encrypted.cleanupPath !== localPath) {
    tmpPaths.push(encrypted.cleanupPath);
  }

  return {
    localPath: encrypted.localPath,
    archiveName: encrypted.archiveName,
    encrypted: encrypted.encrypted,
    tmpPaths,
    cleanupIdentity,
  };
}

export { packLocalPathArchive };
