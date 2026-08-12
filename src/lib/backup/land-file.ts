import type { peers, servers } from '@/lib/db/schema';
import { uploadPeerObject } from '@/lib/peer/client';
import {
  formatS3ArtifactPath,
  joinS3Key,
  uploadFile,
  type S3ProfileConfig,
} from '@/lib/s3';
import {
  connectToServer,
  getBackupTransportCapabilities,
  pushFileToRemote,
  resolvePrivateKeyForServer,
  writeTemporarySshIdentityFile,
  type Server,
} from '@/lib/ssh';
import fs from 'fs/promises';
import type { NodeSSH } from 'node-ssh';
import path from 'path';

type ServerRow = typeof servers.$inferSelect;
export type PeerRow = typeof peers.$inferSelect;

function normalizeServer(server: ServerRow): Server {
  return {
    ...server,
    password: server.password || null,
    privateKey: server.privateKey || null,
    sshKeyId: server.sshKeyId || null,
    systemKeyPath: server.systemKeyPath || null,
  };
}

/**
 * Land a single local file to local / server / S3 / peer destination.
 */
export async function landLocalFileArtifact(options: {
  localFilePath: string;
  archiveName: string;
  destinationKind: 'local' | 'server' | 's3' | 'peer';
  localDestination?: string | null;
  remoteDestination?: string | null;
  destinationServer?: ServerRow | null;
  destSsh?: NodeSSH | null;
  s3DestProfile?: S3ProfileConfig | null;
  s3DestinationPrefix?: string | null;
  destinationPeer?: PeerRow | null;
  peerPrefix?: string;
}): Promise<{
  artifactPath: string;
  usedMethod: string;
  stdout: string;
  destSsh: NodeSSH | null;
  cleanupDestIdentity?: () => Promise<void>;
}> {
  const { localFilePath, archiveName, destinationKind } = options;

  if (destinationKind === 'local') {
    if (!options.localDestination) {
      throw new Error('Local destination path is required');
    }
    const localArchivePath = path.join(options.localDestination, archiveName);
    await fs.mkdir(options.localDestination, { recursive: true });
    await fs.copyFile(localFilePath, localArchivePath);
    const stats = await fs.stat(localArchivePath);
    return {
      artifactPath: localArchivePath,
      usedMethod: 'file-local',
      stdout: `Archive: ${archiveName}\nLocal path: ${localArchivePath}\nSize: ${stats.size} bytes`,
      destSsh: options.destSsh ?? null,
    };
  }

  if (destinationKind === 'server') {
    if (!options.destinationServer || !options.remoteDestination) {
      throw new Error('Destination server is required');
    }
    let destSsh = options.destSsh;
    if (!destSsh) {
      destSsh = await connectToServer(normalizeServer(options.destinationServer));
    }
    const destKey = await resolvePrivateKeyForServer(normalizeServer(options.destinationServer));
    const { path: destKeyPath, cleanup: cleanupDestIdentity } =
      await writeTemporarySshIdentityFile(destKey);
    const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(destSsh);
    const remoteArchivePath = `${options.remoteDestination.replace(/\/+$/, '')}/${archiveName}`;
    const push = await pushFileToRemote({
      localPath: localFilePath,
      remotePath: remoteArchivePath,
      username: options.destinationServer.username,
      host: options.destinationServer.host,
      port: options.destinationServer.port,
      identityKeyPath: destKeyPath,
      rsyncAvailable,
      scpAvailable,
    });
    return {
      artifactPath: remoteArchivePath,
      usedMethod: 'file-push',
      stdout: [
        `Archive: ${archiveName}`,
        `Remote path: ${remoteArchivePath}`,
        push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      destSsh,
      cleanupDestIdentity,
    };
  }

  if (destinationKind === 's3') {
    if (!options.s3DestProfile || options.s3DestinationPrefix == null) {
      throw new Error('S3 destination is required');
    }
    const key = joinS3Key(options.s3DestinationPrefix, archiveName);
    const uploaded = await uploadFile(options.s3DestProfile, localFilePath, key);
    const artifactPath = formatS3ArtifactPath(options.s3DestProfile.bucket, key);
    return {
      artifactPath,
      usedMethod: 'file-s3',
      stdout: `Archive: ${archiveName}\nS3: ${artifactPath}\nSize: ${uploaded.size} bytes`,
      destSsh: options.destSsh ?? null,
    };
  }

  if (destinationKind === 'peer') {
    if (!options.destinationPeer) {
      throw new Error('Destination peer is required');
    }
    const prefix = (options.peerPrefix || '').replace(/^\/+|\/+$/g, '');
    const objectKey = prefix ? `${prefix}/${archiveName}` : archiveName;
    const peer = options.destinationPeer;
    const transport = peer.transport === 'direct' ? 'direct' : 'mailbox';

    if (transport === 'direct') {
      const uploaded = await uploadPeerObject(peer, objectKey, localFilePath);
      return {
        artifactPath: `peer://${peer.id}/${objectKey}`,
        usedMethod: 'file-peer',
        stdout: `Archive: ${archiveName}\nPeer: ${peer.name}\nObject: ${objectKey}\nSize: ${uploaded.size} bytes`,
        destSsh: options.destSsh ?? null,
      };
    }

    const { writeStagedObject } = await import('@/lib/peer/staging');
    const staged = await writeStagedObject(peer.id, objectKey, localFilePath);
    return {
      artifactPath: `peer://${peer.id}/${objectKey}`,
      usedMethod: 'file-peer-mailbox',
      stdout: [
        `Archive: ${archiveName}`,
        `Peer: ${peer.name}`,
        `Object: ${objectKey}`,
        `Size: ${staged.size} bytes`,
        `Mailbox: staged (waiting for bro to pull — not a failure)`,
      ].join('\n'),
      destSsh: options.destSsh ?? null,
    };
  }

  throw new Error(`Unsupported destination kind: ${destinationKind}`);
}
