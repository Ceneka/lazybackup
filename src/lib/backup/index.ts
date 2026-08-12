import { db } from '@/lib/db';
import { backupConfigs, backupHistory, peers, s3Profiles, servers } from '@/lib/db/schema';
import { normalizeS3Prefix } from '@/lib/backup/destination';
import { landLocalFileArtifact } from '@/lib/backup/land-file';
import { materializeLocalArtifact, packLocalPathArchive } from '@/lib/backup/materialize';
import { packLazybackupInstance } from '@/lib/backup/instance-export';
import {
  archiveFileNameForDatabase,
  cleanupLocalDbTmpDir,
  cleanupRemoteDbTmpDir,
  connectionFromConfig,
  packDatabaseDumpLocal,
  packDatabaseDumpRemote,
  restoreDatabaseLocal,
  restoreDatabaseRemote,
} from '@/lib/database';
import {
  cleanupRemoteDir,
  packDockerVolume,
  restoreDockerVolume,
} from '@/lib/docker/volumes';
import { decryptLocalFile, isAgeEncryptedPath, stripAgeExtension } from '@/lib/crypto/files';
import { requireDecryptIdentities } from '@/lib/crypto/keys';
import { downloadPeerObject } from '@/lib/peer/client';
import {
  cleanupS3FileRetention,
  cleanupS3OldVersions,
  downloadFile,
  downloadPrefix,
  formatS3ArtifactPath,
  joinS3Key,
  parseS3ArtifactPath,
  uploadDirectory,
  uploadFile,
  type S3ProfileConfig,
} from '@/lib/s3';
import {
  connectToServer,
  getBackupTransportCapabilities,
  pullFileFromRemote,
  pushFileToRemote,
  resolvePrivateKeyForServer,
  writeTemporarySshIdentityFile,
} from '@/lib/ssh';
import {
  cleanupRemoteOldFiles,
  cleanupRemoteOldVersions,
  ensureRemoteDirectory,
  generateEphemeralEd25519KeyPair,
  installEphemeralAuthorizedKey,
  probeSourceCanReachDest,
  removeEphemeralAuthorizedKey,
  runEphemeralDirectRsync,
} from '@/lib/ssh/ephemeral';
import { buildRsyncCommand, shellSingleQuote } from '@/lib/ssh/rsync';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { Stats } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseRsyncOutput } from '../utils/rsync-parser';
import { selectFilesToDelete, type RetentionAgeUnit } from './file-retention';
import { assertCanStartBackup } from './concurrent-run';
import { createBackupHistoryEntry, updateBackupHistoryFailure, updateBackupHistorySuccess } from './history';
import {
  buildFileRetentionLog,
  buildPreBackupLog,
  combineBackupLog,
  formatPreBackupCommandLog,
  LOG_SECTION,
} from './log-format';

type ServerRow = typeof servers.$inferSelect;
type S3ProfileRow = typeof s3Profiles.$inferSelect;
type PeerRow = typeof peers.$inferSelect;

export type BackupConfigWithEndpoints = {
  id: string;
  sourceKind?: 'local' | 'server' | 's3' | null;
  serverId?: string | null;
  sourceS3ProfileId?: string | null;
  destinationKind?: 'local' | 'server' | 's3' | 'peer' | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPeerId?: string | null;
  name: string;
  sourceType?: 'path' | 'docker_volume' | 'database' | 'lazybackup_instance' | null;
  sourcePath: string;
  destinationPath: string;
  schedule: string;
  excludePatterns?: string | null;
  preBackupCommands?: string | null;
  dbEngine?: 'postgres' | 'mysql' | 'mariadb' | null;
  dbClient?: 'native' | 'docker' | null;
  dbContainer?: string | null;
  dbHost?: string | null;
  dbPort?: number | null;
  dbUser?: string | null;
  dbPassword?: string | null;
  instanceBackupPassphrase?: string | null;
  enabled: boolean;
  enableEncryption?: boolean | null;
  enableVersioning: boolean;
  versionsToKeep?: number | null;
  enableFileRetention?: boolean | null;
  retentionMaxAge?: number | null;
  retentionMaxAgeUnit?: RetentionAgeUnit | null;
  retentionMinKeep?: number | null;
  server?: ServerRow | null;
  destinationServer?: ServerRow | null;
  sourceS3Profile?: S3ProfileRow | null;
  destinationS3Profile?: S3ProfileRow | null;
  destinationPeer?: PeerRow | null;
};

function toS3ProfileConfig(row: S3ProfileRow): S3ProfileConfig {
  return {
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: row.accessKeyId,
    secretAccessKey: row.secretAccessKey,
    forcePathStyle: row.forcePathStyle,
  };
}

function expandLocalPath(dest: string): string {
  let backupDestination = dest;
  if (backupDestination.startsWith('~')) {
    backupDestination = backupDestination.replace('~', process.env.HOME || os.homedir());
  }
  if (!path.isAbsolute(backupDestination)) {
    backupDestination = path.resolve(backupDestination);
  }
  return backupDestination;
}

function slugifyArchiveBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'backup';
}

function normalizeServer(server: ServerRow) {
  return {
    ...server,
    password: server.password || null,
    privateKey: server.privateKey || null,
    sshKeyId: server.sshKeyId || null,
    systemKeyPath: server.systemKeyPath || null,
  };
}

function sshShellForIdentity(port: number, keyPath: string): string {
  return `ssh -p ${port} -i ${shellSingleQuote(keyPath)} -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
}

async function runLocalPreBackupCommands(commandsText: string): Promise<string> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);
  const commands = commandsText.split('\n').filter(Boolean);
  const commandLogs: string[] = [];

  for (const command of commands) {
    console.log(`Executing local command: ${command}`);
    try {
      const result = await execPromise(command);
      commandLogs.push(
        formatPreBackupCommandLog(command, {
          code: 0,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
        })
      );
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      commandLogs.push(
        formatPreBackupCommandLog(command, {
          code: e.code ?? 1,
          stdout: e.stdout || '',
          stderr: e.stderr || e.message || '',
        })
      );
    }
  }

  return buildPreBackupLog(commandLogs);
}

async function pullPathFromServer(options: {
  ssh: Awaited<ReturnType<typeof connectToServer>>;
  server: ServerRow;
  remotePath: string;
  localDestination: string;
  keyPath: string;
  excludePatterns: string[];
}): Promise<{ stdout: string; stderr: string; method: 'rsync' | 'scp' }> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(options.ssh);
  const localSshShell = sshShellForIdentity(options.server.port, options.keyPath);
  const remoteSource = `${options.server.username}@${options.server.host}:${options.remotePath}/`;

  if (rsyncAvailable) {
    const rsyncCommand = buildRsyncCommand(
      remoteSource,
      options.localDestination,
      options.excludePatterns,
      [],
      localSshShell
    );
    const result = await execPromise(rsyncCommand);
    return { stdout: result.stdout, stderr: result.stderr, method: 'rsync' };
  }

  if (!scpAvailable) {
    throw new Error(
      'Cannot pull: rsync was not found on the remote host and the SCP client was not found on this machine.'
    );
  }

  const findCommand = await buildFindCommand(options.remotePath, options.excludePatterns);
  const fileListResult = await options.ssh.execCommand(findCommand);
  const filesToCopy = fileListResult.stdout.split('\n').filter(Boolean);

  if (filesToCopy.length === 0) {
    throw new Error('No files to copy, skipping backup');
  }

  let transferredFiles = 0;
  let totalSize = 0;
  const scpPromises = [];

  for (const filePath of filesToCopy) {
    if (filePath.endsWith('/')) {
      await fs.mkdir(path.join(options.localDestination, filePath), { recursive: true });
      continue;
    }

    const remoteFilePath = path.join(options.remotePath, filePath);
    const localFilePath = path.join(options.localDestination, filePath);
    await fs.mkdir(path.dirname(localFilePath), { recursive: true });

    const scpOpts = `-P ${options.server.port} -F /dev/null -i ${shellSingleQuote(options.keyPath)} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
    const scpCommand = `scp ${scpOpts} ${options.server.username}@${options.server.host}:"${remoteFilePath}" "${localFilePath}"`;

    scpPromises.push(
      execPromise(scpCommand)
        .then(() => {
          transferredFiles++;
          return fs.stat(localFilePath);
        })
        .then((stats: Stats) => {
          totalSize += stats.size;
        })
    );
  }

  await Promise.all(scpPromises);

  return {
    method: 'scp',
    stdout: `SCP Backup Summary:\nNumber of files: ${transferredFiles}\nTotal file size: ${totalSize}\nTotal transferred file size: ${totalSize}`,
    stderr: '',
  };
}

async function pushPathToServer(options: {
  ssh: Awaited<ReturnType<typeof connectToServer>>;
  server: ServerRow;
  localSource: string;
  remoteDestination: string;
  keyPath: string;
  excludePatterns: string[];
}): Promise<{ stdout: string; stderr: string; method: 'rsync' | 'scp' }> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(options.ssh);
  await ensureRemoteDirectory(options.ssh, options.remoteDestination);

  const localSshShell = sshShellForIdentity(options.server.port, options.keyPath);
  const source = options.localSource.endsWith('/')
    ? options.localSource
    : `${options.localSource}/`;
  const remoteTarget = `${options.server.username}@${options.server.host}:${options.remoteDestination}`;

  if (rsyncAvailable) {
    const rsyncCommand = buildRsyncCommand(
      source,
      remoteTarget,
      options.excludePatterns,
      [],
      localSshShell
    );
    const result = await execPromise(rsyncCommand);
    return { stdout: result.stdout, stderr: result.stderr, method: 'rsync' };
  }

  if (!scpAvailable) {
    throw new Error(
      'Cannot push: rsync was not found on the remote host and the SCP client was not found on this machine.'
    );
  }

  const scpOpts = `-P ${options.server.port} -F /dev/null -i ${shellSingleQuote(options.keyPath)} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -r`;
  const scpCommand = `scp ${scpOpts} ${shellSingleQuote(source)} ${shellSingleQuote(remoteTarget)}`;
  const result = await execPromise(scpCommand);
  return { stdout: result.stdout, stderr: result.stderr, method: 'scp' };
}

async function localPathCopy(
  sourcePath: string,
  destinationPath: string,
  excludePatterns: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  await fs.mkdir(destinationPath, { recursive: true });
  const source = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`;
  const rsyncCommand = buildRsyncCommand(source, destinationPath, excludePatterns);
  return execPromise(rsyncCommand);
}

async function transferServerToServer(options: {
  sourceServer: ServerRow;
  destServer: ServerRow;
  sourcePath: string;
  destPath: string;
  excludePatterns: string[];
}): Promise<{ stdout: string; stderr: string; mode: 'ephemeral' | 'relay' }> {
  const sourceConfig = normalizeServer(options.sourceServer);
  const destConfig = normalizeServer(options.destServer);

  const sourceSsh = await connectToServer(sourceConfig);
  const destSsh = await connectToServer(destConfig);

  let ephemeralCleanup: (() => Promise<void>) | undefined;
  let marker: string | undefined;

  try {
    await ensureRemoteDirectory(destSsh, options.destPath);

    const ephemeral = await generateEphemeralEd25519KeyPair();
    ephemeralCleanup = ephemeral.cleanup;
    marker = ephemeral.marker;

    await installEphemeralAuthorizedKey(destSsh, ephemeral.marker, ephemeral.publicKey);

    const reachable = await probeSourceCanReachDest(
      sourceSsh,
      options.destServer.host,
      options.destServer.port
    );

    if (reachable) {
      try {
        const result = await runEphemeralDirectRsync({
          sourceSsh,
          sourcePath: options.sourcePath,
          destUsername: options.destServer.username,
          destHost: options.destServer.host,
          destPort: options.destServer.port,
          destPath: options.destPath,
          ephemeralPrivateKeyPath: ephemeral.privateKeyPath,
          excludePatterns: options.excludePatterns,
        });
        return {
          mode: 'ephemeral',
          stdout: `Transfer mode: ephemeral (direct source→dest)\n${result.stdout}`,
          stderr: result.stderr,
        };
      } catch (directError) {
        console.warn(`Ephemeral direct transfer failed, falling back to relay: ${directError}`);
      }
    } else {
      console.log('Source cannot reach destination; using relay via LazyBackup host');
    }

    // Relay: pull to temp on host, push to dest
    const relayDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-relay-'));
    try {
      const sourceKey = await resolvePrivateKeyForServer(sourceConfig);
      const { path: sourceKeyPath, cleanup: cleanupSourceKey } =
        await writeTemporarySshIdentityFile(sourceKey);
      try {
        await pullPathFromServer({
          ssh: sourceSsh,
          server: options.sourceServer,
          remotePath: options.sourcePath,
          localDestination: relayDir,
          keyPath: sourceKeyPath,
          excludePatterns: options.excludePatterns,
        });
      } finally {
        await cleanupSourceKey();
      }

      const destKey = await resolvePrivateKeyForServer(destConfig);
      const { path: destKeyPath, cleanup: cleanupDestKey } =
        await writeTemporarySshIdentityFile(destKey);
      try {
        const push = await pushPathToServer({
          ssh: destSsh,
          server: options.destServer,
          localSource: relayDir,
          remoteDestination: options.destPath,
          keyPath: destKeyPath,
          excludePatterns: [],
        });
        return {
          mode: 'relay',
          stdout: `Transfer mode: relay (via LazyBackup host)\n${push.stdout}`,
          stderr: push.stderr,
        };
      } finally {
        await cleanupDestKey();
      }
    } finally {
      await fs.rm(relayDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    if (marker) {
      await removeEphemeralAuthorizedKey(destSsh, marker).catch(() => {});
    }
    await ephemeralCleanup?.();
    sourceSsh.dispose();
    destSsh.dispose();
  }
}

/**
 * Execute a backup based on its configuration
 */
export async function executeBackup(config: BackupConfigWithEndpoints, historyId: string): Promise<void> {
  let sourceSsh: Awaited<ReturnType<typeof connectToServer>> | null = null;
  let destSsh: Awaited<ReturnType<typeof connectToServer>> | null = null;
  let cleanupIdentity: (() => Promise<void>) | undefined;
  let cleanupDestIdentity: (() => Promise<void>) | undefined;
  let preBackupLog = '';
  let remoteTmpDir: string | null = null;
  let localDbTmpDir: string | null = null;
  /** 'docker' | 'database' — how to clean remoteTmpDir */
  let remoteTmpKind: 'docker' | 'database' | null = null;
  const encryptTmpPaths: string[] = [];

  try {
    console.log(`Starting backup: ${config.name} (${historyId})`);

    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      throw new Error('Not in Node.js environment');
    }

    const sourceKind = config.sourceKind || 'server';
    const destinationKind: 'local' | 'server' | 's3' | 'peer' =
      config.destinationKind || 'local';
    const sourceType = config.sourceType || 'path';
    const excludePatterns = config.excludePatterns
      ? config.excludePatterns.split('\n').filter(Boolean)
      : [];
    const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');

    if (sourceKind === 'server' && !config.server) {
      throw new Error('Source server is missing from backup configuration');
    }
    if (destinationKind === 'server' && !config.destinationServer) {
      throw new Error('Destination server is missing from backup configuration');
    }
    if (sourceKind === 's3' && !config.sourceS3Profile) {
      throw new Error('Source S3 profile is missing from backup configuration');
    }
    if (destinationKind === 's3' && !config.destinationS3Profile) {
      throw new Error('Destination S3 profile is missing from backup configuration');
    }
    if (destinationKind === 'peer' && !config.destinationPeer) {
      throw new Error('Destination bro peer is missing from backup configuration');
    }
    if (sourceType === 'docker_volume' && sourceKind !== 'server') {
      throw new Error('Docker volume backups require a source server');
    }
    if (sourceKind === 's3' && sourceType !== 'path') {
      throw new Error('S3 sources only support path (object prefix) backups');
    }

    if (sourceType === 'lazybackup_instance' && sourceKind !== 'local') {
      throw new Error('LazyBackup instance backups require a local source');
    }
    if (sourceType === 'lazybackup_instance' && destinationKind === 'peer') {
      throw new Error('LazyBackup instance backups cannot use Bro destinations');
    }

    const isPeerDestination = destinationKind === 'peer';
    const enableEncryption =
      sourceType === 'lazybackup_instance'
        ? false
        : Boolean(config.enableEncryption) || isPeerDestination;
    const useEncryptedLand = enableEncryption;

    // Pre-backup commands (not applicable for S3 sources)
    if (
      config.preBackupCommands &&
      config.preBackupCommands.trim() &&
      sourceKind !== 's3'
    ) {
      if (sourceKind === 'server' && config.server) {
        sourceSsh = await connectToServer(normalizeServer(config.server));
        console.log(`Running pre-backup commands for ${config.name}`);
        const commands = config.preBackupCommands.split('\n').filter(Boolean);
        const commandLogs: string[] = [];
        for (const command of commands) {
          console.log(`Executing command: ${command}`);
          const result = await sourceSsh.execCommand(command);
          commandLogs.push(formatPreBackupCommandLog(command, result));
          if (result.stderr) {
            console.warn(`Command produced warnings/errors: ${result.stderr}`);
          }
        }
        preBackupLog = buildPreBackupLog(commandLogs);
      } else {
        preBackupLog = await runLocalPreBackupCommands(config.preBackupCommands);
      }
    }

    // Resolve destination path (with optional versioning subdir)
    let localDestination: string | null = null;
    let remoteDestination: string | null = null;
    let s3DestinationPrefix: string | null = null;
    let s3DestProfile: S3ProfileConfig | null = null;
    let s3SourceProfile: S3ProfileConfig | null = null;
    let peerPrefix: string | null = null;

    if (config.sourceS3Profile) {
      s3SourceProfile = toS3ProfileConfig(config.sourceS3Profile);
    }
    if (config.destinationS3Profile) {
      s3DestProfile = toS3ProfileConfig(config.destinationS3Profile);
    }

    if (destinationKind === 'local') {
      localDestination = expandLocalPath(config.destinationPath);
      if (config.enableVersioning) {
        localDestination = path.join(localDestination, timestamp);
      }
      await fs.mkdir(localDestination, { recursive: true });
    } else if (destinationKind === 'server' && config.destinationServer) {
      remoteDestination = config.destinationPath.replace(/\/+$/, '') || '/';
      if (config.enableVersioning) {
        remoteDestination = `${remoteDestination}/${timestamp}`;
      }
      destSsh = await connectToServer(normalizeServer(config.destinationServer));
      await ensureRemoteDirectory(destSsh, remoteDestination);
    } else if (destinationKind === 's3' && s3DestProfile) {
      s3DestinationPrefix = normalizeS3Prefix(config.destinationPath);
      if (config.enableVersioning) {
        s3DestinationPrefix = joinS3Key(s3DestinationPrefix, timestamp);
      }
    } else if (destinationKind === 'peer') {
      peerPrefix = normalizeS3Prefix(config.destinationPath);
      if (config.enableVersioning) {
        peerPrefix = peerPrefix ? `${peerPrefix}/${timestamp}` : timestamp;
      }
    }

    let backupResult: { stdout: string; stderr: string };
    let usedMethod: string = 'rsync';
    let artifactPath =
      destinationKind === 'local'
        ? localDestination!
        : destinationKind === 'server'
          ? remoteDestination!
          : destinationKind === 'peer'
            ? `peer://${config.destinationPeer!.id}/${peerPrefix || ''}`
            : formatS3ArtifactPath(s3DestProfile!.bucket, s3DestinationPrefix || '');

    // --- LazyBackup instance meta-backup ---
    if (sourceType === 'lazybackup_instance') {
      const packed = await packLazybackupInstance({
        passphrase: config.instanceBackupPassphrase,
        archiveBaseName: `lazybackup-instance-${timestamp}`,
      });
      encryptTmpPaths.push(packed.tmpDir);

      const landed = await landLocalFileArtifact({
        localFilePath: packed.localPath,
        archiveName: packed.archiveName,
        destinationKind: destinationKind as 'local' | 'server' | 's3' | 'peer',
        localDestination,
        remoteDestination,
        destinationServer: config.destinationServer,
        destSsh,
        s3DestProfile,
        s3DestinationPrefix,
        destinationPeer: config.destinationPeer,
        peerPrefix: peerPrefix || '',
      });
      if (landed.cleanupDestIdentity) {
        cleanupDestIdentity = landed.cleanupDestIdentity;
      }
      destSsh = landed.destSsh;
      usedMethod = packed.passphraseWrapped
        ? `lazybackup-instance-passphrase-${landed.usedMethod}`
        : `lazybackup-instance-${landed.usedMethod}`;
      artifactPath = landed.artifactPath;
      backupResult = {
        stdout: [
          'Source: LazyBackup instance (SQLite + age vault + SSH keys)',
          packed.passphraseWrapped ? 'Wrap: age passphrase' : 'Wrap: none (trusted destination)',
          landed.stdout,
        ]
          .filter(Boolean)
          .join('\n'),
        stderr: '',
      };
    } else if (sourceType === 'database') {
      const dbConn = connectionFromConfig(config);
      const archiveName = archiveFileNameForDatabase(dbConn.database);
      console.log(`Dumping database: ${dbConn.engine}/${dbConn.database}`);

      let packedArchivePath: string;
      let packStdout = '';

      if (sourceKind === 'local') {
        const packed = await packDatabaseDumpLocal(dbConn);
        localDbTmpDir = packed.tmpDir;
        packedArchivePath = packed.archivePath;
        packStdout = packed.stdout;
      } else {
        if (!config.server) {
          throw new Error('Source server required for remote database backup');
        }
        if (!sourceSsh) {
          sourceSsh = await connectToServer(normalizeServer(config.server));
        }
        const packed = await packDatabaseDumpRemote(sourceSsh, dbConn);
        remoteTmpDir = packed.tmpDir;
        remoteTmpKind = 'database';
        packedArchivePath = packed.archivePath;
        packStdout = packed.stdout;
      }

      if (useEncryptedLand) {
        const materialized = await materializeLocalArtifact({
          enableEncryption: true,
          archiveName,
          localPath: sourceKind === 'local' ? packedArchivePath : null,
          remotePath: sourceKind === 'server' ? packedArchivePath : null,
          sourceServer: config.server ? normalizeServer(config.server) : null,
          sourceSsh,
        });
        encryptTmpPaths.push(...materialized.tmpPaths);
        if (materialized.cleanupIdentity) {
          cleanupIdentity = materialized.cleanupIdentity;
        }
        const landed = await landLocalFileArtifact({
          localFilePath: materialized.localPath,
          archiveName: materialized.archiveName,
          destinationKind: destinationKind as 'local' | 'server' | 's3' | 'peer',
          localDestination,
          remoteDestination,
          destinationServer: config.destinationServer,
          destSsh,
          s3DestProfile,
          s3DestinationPrefix,
          destinationPeer: config.destinationPeer,
          peerPrefix: peerPrefix || '',
        });
        if (landed.cleanupDestIdentity) {
          cleanupDestIdentity = landed.cleanupDestIdentity;
        }
        destSsh = landed.destSsh;
        usedMethod = `database-${landed.usedMethod}${materialized.encrypted ? '-age' : ''}`;
        artifactPath = landed.artifactPath;
        backupResult = {
          stdout: [
            `Engine: ${dbConn.engine}`,
            `Database: ${dbConn.database}`,
            `Client: ${dbConn.client}`,
            materialized.encrypted ? 'Encryption: age' : '',
            landed.stdout,
            packStdout?.trim() ? `--- dump stdout ---\n${packStdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (sourceKind === 'local' && destinationKind === 'local' && localDestination) {
        const localArchivePath = path.join(localDestination, archiveName);
        await fs.copyFile(packedArchivePath, localArchivePath);
        usedMethod = 'database';
        artifactPath = localArchivePath;
        const stats = await fs.stat(localArchivePath);
        backupResult = {
          stdout: [
            `Engine: ${dbConn.engine}`,
            `Database: ${dbConn.database}`,
            `Client: ${dbConn.client}`,
            `Archive: ${archiveName}`,
            `Local path: ${localArchivePath}`,
            `Size: ${stats.size} bytes`,
            packStdout?.trim() ? `--- dump stdout ---\n${packStdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (sourceKind === 'local' && destinationKind === 'server' && config.destinationServer && remoteDestination) {
        if (!destSsh) {
          destSsh = await connectToServer(normalizeServer(config.destinationServer));
        }
        const destKey = await resolvePrivateKeyForServer(normalizeServer(config.destinationServer));
        const { path: destKeyPath, cleanup: cleanupDestKey } =
          await writeTemporarySshIdentityFile(destKey);
        cleanupDestIdentity = cleanupDestKey;
        const { rsyncAvailable: destRsync, scpAvailable: destScp } =
          await getBackupTransportCapabilities(destSsh);
        const remoteArchivePath = `${remoteDestination.replace(/\/+$/, '')}/${archiveName}`;
        const push = await pushFileToRemote({
          localPath: packedArchivePath,
          remotePath: remoteArchivePath,
          username: config.destinationServer.username,
          host: config.destinationServer.host,
          port: config.destinationServer.port,
          identityKeyPath: destKeyPath,
          rsyncAvailable: destRsync,
          scpAvailable: destScp,
        });
        usedMethod = 'database';
        artifactPath = remoteArchivePath;
        backupResult = {
          stdout: [
            `Engine: ${dbConn.engine}`,
            `Database: ${dbConn.database}`,
            `Archive: ${archiveName}`,
            `Remote path: ${remoteArchivePath}`,
            push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (sourceKind === 'server' && config.server && destinationKind === 'local' && localDestination) {
        const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
        const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
        cleanupIdentity = cleanupKeyFile;
        const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(sourceSsh!);
        const localArchivePath = path.join(localDestination, archiveName);
        const pull = await pullFileFromRemote({
          remotePath: packedArchivePath,
          localPath: localArchivePath,
          username: config.server.username,
          host: config.server.host,
          port: config.server.port,
          identityKeyPath: keyPath,
          rsyncAvailable,
          scpAvailable,
        });
        usedMethod = 'database';
        artifactPath = localArchivePath;
        const stats = await fs.stat(localArchivePath);
        backupResult = {
          stdout: [
            `Engine: ${dbConn.engine}`,
            `Database: ${dbConn.database}`,
            `Archive: ${archiveName}`,
            `Local path: ${localArchivePath}`,
            `Size: ${stats.size} bytes`,
            `Transfer: ${pull.method}`,
            packStdout?.trim() ? `--- dump stdout ---\n${packStdout.trim()}` : '',
            pull.stdout?.trim() ? `--- transfer stdout ---\n${pull.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (
        sourceKind === 'server' &&
        config.server &&
        destinationKind === 'server' &&
        config.destinationServer &&
        remoteDestination
      ) {
        const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
        const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
        cleanupIdentity = cleanupKeyFile;
        const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(sourceSsh!);
        const relayFile = path.join(os.tmpdir(), `lazybackup-db-${Date.now()}-${archiveName}`);
        try {
          await pullFileFromRemote({
            remotePath: packedArchivePath,
            localPath: relayFile,
            username: config.server.username,
            host: config.server.host,
            port: config.server.port,
            identityKeyPath: keyPath,
            rsyncAvailable,
            scpAvailable,
          });
          if (!destSsh) {
            destSsh = await connectToServer(normalizeServer(config.destinationServer));
          }
          const destKey = await resolvePrivateKeyForServer(normalizeServer(config.destinationServer));
          const { path: destKeyPath, cleanup: cleanupDestKey } =
            await writeTemporarySshIdentityFile(destKey);
          cleanupDestIdentity = cleanupDestKey;
          const { rsyncAvailable: destRsync, scpAvailable: destScp } =
            await getBackupTransportCapabilities(destSsh);
          const remoteArchivePath = `${remoteDestination.replace(/\/+$/, '')}/${archiveName}`;
          const push = await pushFileToRemote({
            localPath: relayFile,
            remotePath: remoteArchivePath,
            username: config.destinationServer.username,
            host: config.destinationServer.host,
            port: config.destinationServer.port,
            identityKeyPath: destKeyPath,
            rsyncAvailable: destRsync,
            scpAvailable: destScp,
          });
          usedMethod = 'database-relay';
          artifactPath = remoteArchivePath;
          backupResult = {
            stdout: [
              `Engine: ${dbConn.engine}`,
              `Database: ${dbConn.database}`,
              `Archive: ${archiveName}`,
              `Remote path: ${remoteArchivePath}`,
              `Transfer mode: relay`,
              push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            stderr: '',
          };
        } finally {
          await fs.unlink(relayFile).catch(() => {});
        }
      } else if (destinationKind === 's3' && s3DestProfile && s3DestinationPrefix != null) {
        let localArchiveForUpload = packedArchivePath;
        let relayFile: string | null = null;
        try {
          if (sourceKind === 'server' && config.server) {
            const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
            const { path: keyPath, cleanup: cleanupKeyFile } =
              await writeTemporarySshIdentityFile(privateKey);
            cleanupIdentity = cleanupKeyFile;
            const { rsyncAvailable, scpAvailable } =
              await getBackupTransportCapabilities(sourceSsh!);
            relayFile = path.join(os.tmpdir(), `lazybackup-db-s3-${Date.now()}-${archiveName}`);
            await pullFileFromRemote({
              remotePath: packedArchivePath,
              localPath: relayFile,
              username: config.server.username,
              host: config.server.host,
              port: config.server.port,
              identityKeyPath: keyPath,
              rsyncAvailable,
              scpAvailable,
            });
            localArchiveForUpload = relayFile;
          }
          const key = joinS3Key(s3DestinationPrefix, archiveName);
          const uploaded = await uploadFile(s3DestProfile, localArchiveForUpload, key);
          usedMethod = sourceKind === 'server' ? 'database-s3-relay' : 'database-s3';
          artifactPath = formatS3ArtifactPath(s3DestProfile.bucket, key);
          backupResult = {
            stdout: [
              `Engine: ${dbConn.engine}`,
              `Database: ${dbConn.database}`,
              `Archive: ${archiveName}`,
              `S3: ${artifactPath}`,
              `Size: ${uploaded.size} bytes`,
              packStdout?.trim() ? `--- dump stdout ---\n${packStdout.trim()}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            stderr: '',
          };
        } finally {
          if (relayFile) await fs.unlink(relayFile).catch(() => {});
        }
      } else {
        throw new Error('Invalid destination for database backup');
      }
    } else if (sourceType === 'docker_volume') {
      // --- Docker volume source ---
      if (!config.server) {
        throw new Error('Source server required for docker volume backup');
      }
      if (!sourceSsh) {
        sourceSsh = await connectToServer(normalizeServer(config.server));
      }

      const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
      const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
      cleanupIdentity = cleanupKeyFile;

      console.log(`Packing Docker volume: ${config.sourcePath}`);
      const packed = await packDockerVolume(sourceSsh, config.sourcePath, excludePatterns);
      remoteTmpDir = packed.remoteTmpDir;
      remoteTmpKind = 'docker';
      const archiveName = `${config.sourcePath}.tar.gz`;

      const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(sourceSsh);

      if (useEncryptedLand) {
        const materialized = await materializeLocalArtifact({
          enableEncryption: true,
          archiveName,
          remotePath: packed.remoteArchivePath,
          sourceServer: normalizeServer(config.server),
          sourceSsh,
        });
        encryptTmpPaths.push(...materialized.tmpPaths);
        if (materialized.cleanupIdentity) {
          cleanupIdentity = materialized.cleanupIdentity;
        }
        const landed = await landLocalFileArtifact({
          localFilePath: materialized.localPath,
          archiveName: materialized.archiveName,
          destinationKind: destinationKind as 'local' | 'server' | 's3' | 'peer',
          localDestination,
          remoteDestination,
          destinationServer: config.destinationServer,
          destSsh,
          s3DestProfile,
          s3DestinationPrefix,
          destinationPeer: config.destinationPeer,
          peerPrefix: peerPrefix || '',
        });
        if (landed.cleanupDestIdentity) {
          cleanupDestIdentity = landed.cleanupDestIdentity;
        }
        destSsh = landed.destSsh;
        usedMethod = `docker-${landed.usedMethod}${materialized.encrypted ? '-age' : ''}`;
        artifactPath = landed.artifactPath;
        backupResult = {
          stdout: [
            `Volume: ${config.sourcePath}`,
            materialized.encrypted ? 'Encryption: age' : '',
            landed.stdout,
            packed.stdout?.trim() ? `--- pack stdout ---\n${packed.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (destinationKind === 'local' && localDestination) {
        const localArchivePath = path.join(localDestination, archiveName);
        const pull = await pullFileFromRemote({
          remotePath: packed.remoteArchivePath,
          localPath: localArchivePath,
          username: config.server.username,
          host: config.server.host,
          port: config.server.port,
          identityKeyPath: keyPath,
          rsyncAvailable,
          scpAvailable,
        });
        usedMethod = 'docker';
        artifactPath = localArchivePath;
        const stats = await fs.stat(localArchivePath);
        backupResult = {
          stdout: [
            `Volume: ${config.sourcePath}`,
            `Archive: ${archiveName}`,
            `Local path: ${localArchivePath}`,
            `Size: ${stats.size} bytes`,
            `Transfer: ${pull.method}`,
            packed.stdout?.trim() ? `--- pack stdout ---\n${packed.stdout.trim()}` : '',
            pull.stdout?.trim() ? `--- transfer stdout ---\n${pull.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } else if (destinationKind === 'server' && config.destinationServer && remoteDestination) {
        // Pack on source → relay/ephemeral to dest path as .tar.gz
        const relayFile = path.join(os.tmpdir(), `lazybackup-docker-${Date.now()}-${archiveName}`);
        try {
          await pullFileFromRemote({
            remotePath: packed.remoteArchivePath,
            localPath: relayFile,
            username: config.server.username,
            host: config.server.host,
            port: config.server.port,
            identityKeyPath: keyPath,
            rsyncAvailable,
            scpAvailable,
          });

          if (!destSsh) {
            destSsh = await connectToServer(normalizeServer(config.destinationServer));
          }
          const destKey = await resolvePrivateKeyForServer(normalizeServer(config.destinationServer));
          const { path: destKeyPath, cleanup: cleanupDestKey } =
            await writeTemporarySshIdentityFile(destKey);
          cleanupDestIdentity = cleanupDestKey;

          const { rsyncAvailable: destRsync, scpAvailable: destScp } =
            await getBackupTransportCapabilities(destSsh);
          const remoteArchivePath = `${remoteDestination.replace(/\/+$/, '')}/${archiveName}`;
          const push = await pushFileToRemote({
            localPath: relayFile,
            remotePath: remoteArchivePath,
            username: config.destinationServer.username,
            host: config.destinationServer.host,
            port: config.destinationServer.port,
            identityKeyPath: destKeyPath,
            rsyncAvailable: destRsync,
            scpAvailable: destScp,
          });

          usedMethod = 'docker-relay';
          artifactPath = remoteArchivePath;
          backupResult = {
            stdout: [
              `Volume: ${config.sourcePath}`,
              `Archive: ${archiveName}`,
              `Remote path: ${remoteArchivePath}`,
              `Transfer mode: relay`,
              push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            stderr: '',
          };
        } finally {
          await fs.unlink(relayFile).catch(() => {});
        }
      } else if (destinationKind === 's3' && s3DestProfile && s3DestinationPrefix != null) {
        const relayFile = path.join(
          os.tmpdir(),
          `lazybackup-docker-s3-${Date.now()}-${archiveName}`
        );
        try {
          await pullFileFromRemote({
            remotePath: packed.remoteArchivePath,
            localPath: relayFile,
            username: config.server.username,
            host: config.server.host,
            port: config.server.port,
            identityKeyPath: keyPath,
            rsyncAvailable,
            scpAvailable,
          });
          const key = joinS3Key(s3DestinationPrefix, archiveName);
          const uploaded = await uploadFile(s3DestProfile, relayFile, key);
          usedMethod = 'docker-s3';
          artifactPath = formatS3ArtifactPath(s3DestProfile.bucket, key);
          backupResult = {
            stdout: [
              `Volume: ${config.sourcePath}`,
              `Archive: ${archiveName}`,
              `S3: ${artifactPath}`,
              `Size: ${uploaded.size} bytes`,
              packed.stdout?.trim() ? `--- pack stdout ---\n${packed.stdout.trim()}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            stderr: '',
          };
        } finally {
          await fs.unlink(relayFile).catch(() => {});
        }
      } else {
        throw new Error('Invalid destination for docker volume backup');
      }
    } else if (useEncryptedLand) {
      // Path (or any remaining) source → single encrypted archive → land
      let localSourceDir: string | null = null;
      let pathTmpDir: string | null = null;

      if (sourceKind === 'local') {
        localSourceDir = expandLocalPath(config.sourcePath);
      } else if (sourceKind === 'server' && config.server) {
        if (!sourceSsh) {
          sourceSsh = await connectToServer(normalizeServer(config.server));
        }
        const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
        const { path: keyPath, cleanup: cleanupKeyFile } =
          await writeTemporarySshIdentityFile(privateKey);
        cleanupIdentity = cleanupKeyFile;
        pathTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-path-'));
        encryptTmpPaths.push(pathTmpDir);
        localSourceDir = pathTmpDir;
        await pullPathFromServer({
          ssh: sourceSsh,
          server: config.server,
          remotePath: config.sourcePath,
          localDestination: pathTmpDir,
          keyPath,
          excludePatterns,
        });
      } else if (sourceKind === 's3' && s3SourceProfile) {
        pathTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-s3src-'));
        encryptTmpPaths.push(pathTmpDir);
        localSourceDir = pathTmpDir;
        await downloadPrefix(s3SourceProfile, normalizeS3Prefix(config.sourcePath), pathTmpDir);
      } else {
        throw new Error('Unsupported source for encrypted path backup');
      }

      const archiveBase = slugifyArchiveBase(config.name || 'backup');
      const packed = await packLocalPathArchive({
        sourcePath: localSourceDir!,
        archiveBaseName: archiveBase,
        enableEncryption: true,
        excludePatterns,
      });
      encryptTmpPaths.push(packed.tmpDir);

      const landed = await landLocalFileArtifact({
        localFilePath: packed.localPath,
        archiveName: packed.archiveName,
        destinationKind: destinationKind as 'local' | 'server' | 's3' | 'peer',
        localDestination,
        remoteDestination,
        destinationServer: config.destinationServer,
        destSsh,
        s3DestProfile,
        s3DestinationPrefix,
        destinationPeer: config.destinationPeer,
        peerPrefix: peerPrefix || '',
      });
      if (landed.cleanupDestIdentity) {
        cleanupDestIdentity = landed.cleanupDestIdentity;
      }
      destSsh = landed.destSsh;
      usedMethod = `path-${landed.usedMethod}-age`;
      artifactPath = landed.artifactPath;
      backupResult = {
        stdout: [`Encryption: age`, landed.stdout].join('\n'),
        stderr: '',
      };
    } else if (sourceKind === 'local' && destinationKind === 'local' && localDestination) {
      const localSource = expandLocalPath(config.sourcePath);
      backupResult = await localPathCopy(localSource, localDestination, excludePatterns);
      usedMethod = 'local-rsync';
      artifactPath = localDestination;
    } else if (sourceKind === 'local' && destinationKind === 'server' && config.destinationServer && remoteDestination) {
      if (!destSsh) {
        destSsh = await connectToServer(normalizeServer(config.destinationServer));
      }
      const destKey = await resolvePrivateKeyForServer(normalizeServer(config.destinationServer));
      const { path: destKeyPath, cleanup: cleanupDestKey } =
        await writeTemporarySshIdentityFile(destKey);
      cleanupDestIdentity = cleanupDestKey;

      const localSource = expandLocalPath(config.sourcePath);
      const push = await pushPathToServer({
        ssh: destSsh,
        server: config.destinationServer,
        localSource,
        remoteDestination,
        keyPath: destKeyPath,
        excludePatterns,
      });
      backupResult = push;
      usedMethod = `push-${push.method}`;
      artifactPath = remoteDestination;
    } else if (sourceKind === 'server' && destinationKind === 'local' && config.server && localDestination) {
      if (!sourceSsh) {
        sourceSsh = await connectToServer(normalizeServer(config.server));
      }
      const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
      const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
      cleanupIdentity = cleanupKeyFile;

      const pull = await pullPathFromServer({
        ssh: sourceSsh,
        server: config.server,
        remotePath: config.sourcePath,
        localDestination,
        keyPath,
        excludePatterns,
      });
      backupResult = pull;
      usedMethod = pull.method;
      artifactPath = localDestination;
    } else if (
      sourceKind === 'server' &&
      destinationKind === 'server' &&
      config.server &&
      config.destinationServer &&
      remoteDestination
    ) {
      // Dispose pre-opened sessions; transferServerToServer manages its own
      if (sourceSsh) {
        sourceSsh.dispose();
        sourceSsh = null;
      }
      if (destSsh) {
        destSsh.dispose();
        destSsh = null;
      }

      const transfer = await transferServerToServer({
        sourceServer: config.server,
        destServer: config.destinationServer,
        sourcePath: config.sourcePath,
        destPath: remoteDestination,
        excludePatterns,
      });
      backupResult = transfer;
      usedMethod = `s2s-${transfer.mode}`;
      artifactPath = remoteDestination;
    } else if (sourceKind === 'local' && destinationKind === 's3' && s3DestProfile && s3DestinationPrefix != null) {
      const localSource = expandLocalPath(config.sourcePath);
      const uploaded = await uploadDirectory(s3DestProfile, localSource, s3DestinationPrefix);
      usedMethod = 'local-s3';
      artifactPath = formatS3ArtifactPath(s3DestProfile.bucket, s3DestinationPrefix);
      backupResult = {
        stdout: [
          `Local source: ${localSource}`,
          `S3: ${artifactPath}`,
          `Files: ${uploaded.fileCount}`,
          `Total size: ${uploaded.totalSize} bytes`,
        ].join('\n'),
        stderr: '',
      };
    } else if (
      sourceKind === 'server' &&
      destinationKind === 's3' &&
      config.server &&
      s3DestProfile &&
      s3DestinationPrefix != null
    ) {
      if (!sourceSsh) {
        sourceSsh = await connectToServer(normalizeServer(config.server));
      }
      const privateKey = await resolvePrivateKeyForServer(normalizeServer(config.server));
      const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
      cleanupIdentity = cleanupKeyFile;
      const relayDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-s3-'));
      try {
        const pull = await pullPathFromServer({
          ssh: sourceSsh,
          server: config.server,
          remotePath: config.sourcePath,
          localDestination: relayDir,
          keyPath,
          excludePatterns,
        });
        const uploaded = await uploadDirectory(s3DestProfile, relayDir, s3DestinationPrefix);
        usedMethod = 'server-s3';
        artifactPath = formatS3ArtifactPath(s3DestProfile.bucket, s3DestinationPrefix);
        backupResult = {
          stdout: [
            `Remote source: ${config.sourcePath}`,
            `S3: ${artifactPath}`,
            `Files: ${uploaded.fileCount}`,
            `Total size: ${uploaded.totalSize} bytes`,
            pull.stdout?.trim() ? `--- pull stdout ---\n${pull.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } finally {
        await fs.rm(relayDir, { recursive: true, force: true }).catch(() => {});
      }
    } else if (sourceKind === 's3' && destinationKind === 'local' && s3SourceProfile && localDestination) {
      const sourcePrefix = normalizeS3Prefix(config.sourcePath);
      const downloaded = await downloadPrefix(s3SourceProfile, sourcePrefix, localDestination);
      usedMethod = 's3-local';
      artifactPath = localDestination;
      backupResult = {
        stdout: [
          `S3 source: ${formatS3ArtifactPath(s3SourceProfile.bucket, sourcePrefix)}`,
          `Local path: ${localDestination}`,
          `Files: ${downloaded.fileCount}`,
          `Total size: ${downloaded.totalSize} bytes`,
        ].join('\n'),
        stderr: '',
      };
    } else if (
      sourceKind === 's3' &&
      destinationKind === 'server' &&
      s3SourceProfile &&
      config.destinationServer &&
      remoteDestination
    ) {
      const sourcePrefix = normalizeS3Prefix(config.sourcePath);
      const relayDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-s3-'));
      try {
        const downloaded = await downloadPrefix(s3SourceProfile, sourcePrefix, relayDir);
        if (!destSsh) {
          destSsh = await connectToServer(normalizeServer(config.destinationServer));
        }
        const destKey = await resolvePrivateKeyForServer(normalizeServer(config.destinationServer));
        const { path: destKeyPath, cleanup: cleanupDestKey } =
          await writeTemporarySshIdentityFile(destKey);
        cleanupDestIdentity = cleanupDestKey;
        const push = await pushPathToServer({
          ssh: destSsh,
          server: config.destinationServer,
          localSource: relayDir,
          remoteDestination,
          keyPath: destKeyPath,
          excludePatterns,
        });
        usedMethod = 's3-server';
        artifactPath = remoteDestination;
        backupResult = {
          stdout: [
            `S3 source: ${formatS3ArtifactPath(s3SourceProfile.bucket, sourcePrefix)}`,
            `Remote path: ${remoteDestination}`,
            `Files: ${downloaded.fileCount}`,
            push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          stderr: '',
        };
      } finally {
        await fs.rm(relayDir, { recursive: true, force: true }).catch(() => {});
      }
    } else if (
      sourceKind === 's3' &&
      destinationKind === 's3' &&
      s3SourceProfile &&
      s3DestProfile &&
      s3DestinationPrefix != null
    ) {
      const sourcePrefix = normalizeS3Prefix(config.sourcePath);
      const relayDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-s3-'));
      try {
        const downloaded = await downloadPrefix(s3SourceProfile, sourcePrefix, relayDir);
        const uploaded = await uploadDirectory(s3DestProfile, relayDir, s3DestinationPrefix);
        usedMethod = 's3-s3';
        artifactPath = formatS3ArtifactPath(s3DestProfile.bucket, s3DestinationPrefix);
        backupResult = {
          stdout: [
            `S3 source: ${formatS3ArtifactPath(s3SourceProfile.bucket, sourcePrefix)}`,
            `S3 dest: ${artifactPath}`,
            `Downloaded: ${downloaded.fileCount} files`,
            `Uploaded: ${uploaded.fileCount} files (${uploaded.totalSize} bytes)`,
          ].join('\n'),
          stderr: '',
        };
      } finally {
        await fs.rm(relayDir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      throw new Error(`Unsupported transfer direction: ${sourceKind} → ${destinationKind}`);
    }

    if (remoteTmpDir && sourceSsh) {
      const cleanup =
        remoteTmpKind === 'database'
          ? cleanupRemoteDbTmpDir(sourceSsh, remoteTmpDir)
          : cleanupRemoteDir(sourceSsh, remoteTmpDir);
      await cleanup.catch((err) => console.warn(`Failed to clean remote temp dir: ${err}`));
      remoteTmpDir = null;
    }
    if (localDbTmpDir) {
      await cleanupLocalDbTmpDir(localDbTmpDir).catch((err) =>
        console.warn(`Failed to clean local db temp dir: ${err}`)
      );
      localDbTmpDir = null;
    }

    console.log(`Backup completed for ${config.name} using ${usedMethod}`);

    // Version / file retention
    let fileRetentionLog = '';
    if (destinationKind === 'local' && localDestination) {
      if (config.enableVersioning && config.versionsToKeep) {
        const baseDir = path.dirname(localDestination);
        await cleanupOldVersions(baseDir, config.versionsToKeep);
      }
      if (
        !config.enableVersioning &&
        config.enableFileRetention &&
        config.retentionMaxAge &&
        config.retentionMinKeep
      ) {
        const deletedFiles = await cleanupOldFiles(
          config.destinationPath,
          config.retentionMaxAge,
          config.retentionMaxAgeUnit || 'days',
          config.retentionMinKeep
        );
        fileRetentionLog = buildFileRetentionLog(deletedFiles);
      }
    } else if (destinationKind === 'server' && config.destinationServer && remoteDestination) {
      if (!destSsh) {
        destSsh = await connectToServer(normalizeServer(config.destinationServer));
      }
      if (config.enableVersioning && config.versionsToKeep) {
        const baseDir = path.posix.dirname(remoteDestination);
        await cleanupRemoteOldVersions(destSsh, baseDir, config.versionsToKeep);
      }
      if (
        !config.enableVersioning &&
        config.enableFileRetention &&
        config.retentionMaxAge &&
        config.retentionMinKeep
      ) {
        const deleted = await cleanupRemoteOldFiles(
          destSsh,
          config.destinationPath,
          config.retentionMaxAge,
          config.retentionMaxAgeUnit || 'days',
          config.retentionMinKeep
        );
        fileRetentionLog = buildFileRetentionLog(deleted);
      }
    } else if (destinationKind === 's3' && s3DestProfile) {
      const basePrefix = normalizeS3Prefix(config.destinationPath);
      if (config.enableVersioning && config.versionsToKeep) {
        const cleaned = await cleanupS3OldVersions(
          s3DestProfile,
          basePrefix,
          config.versionsToKeep
        );
        if (cleaned.names.length > 0) {
          fileRetentionLog = buildFileRetentionLog(cleaned.names);
        }
      }
      if (
        !config.enableVersioning &&
        config.enableFileRetention &&
        config.retentionMaxAge &&
        config.retentionMinKeep
      ) {
        const cleaned = await cleanupS3FileRetention(s3DestProfile, basePrefix, {
          maxAge: config.retentionMaxAge,
          unit: config.retentionMaxAgeUnit || 'days',
          minKeep: config.retentionMinKeep,
        });
        fileRetentionLog = buildFileRetentionLog(cleaned.names);
      }
    }

    const isArchiveTransfer =
      usedMethod.startsWith('docker') ||
      usedMethod.startsWith('database') ||
      usedMethod.startsWith('lazybackup-instance');
    const parsedOutput =
      isArchiveTransfer && destinationKind === 'local'
        ? {
            fileCount: 1,
            totalSize: (await fs.stat(artifactPath)).size,
            transferredSize: (await fs.stat(artifactPath)).size,
          }
        : isArchiveTransfer && destinationKind === 's3'
          ? {
              fileCount: 1,
              totalSize: Number(/Size: (\d+) bytes/.exec(backupResult.stdout)?.[1] || 0),
              transferredSize: Number(/Size: (\d+) bytes/.exec(backupResult.stdout)?.[1] || 0),
            }
          : parseRsyncOutput(backupResult.stdout);

    await updateBackupHistorySuccess(historyId, {
      ...parsedOutput,
      logOutput: combineBackupLog(preBackupLog, backupResult.stdout, usedMethod, fileRetentionLog),
      artifactPath,
    });
  } catch (error) {
    console.error(`Backup failed: ${error}`);
    if (remoteTmpDir && sourceSsh) {
      const cleanup =
        remoteTmpKind === 'database'
          ? cleanupRemoteDbTmpDir(sourceSsh, remoteTmpDir)
          : cleanupRemoteDir(sourceSsh, remoteTmpDir);
      await cleanup.catch(() => {});
    }
    if (localDbTmpDir) {
      await cleanupLocalDbTmpDir(localDbTmpDir).catch(() => {});
    }
    await updateBackupHistoryFailure(
      historyId,
      error instanceof Error ? error.message : 'Unknown error',
      preBackupLog ? { logOutput: preBackupLog } : undefined
    );
    throw error;
  } finally {
    for (const p of encryptTmpPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    await cleanupIdentity?.();
    await cleanupDestIdentity?.();
    sourceSsh?.dispose();
    destSsh?.dispose();
  }
}

/**
 * Ensure a restore artifact is available as a local file (decrypted if `.age`).
 * Downloads from S3 or peer when needed; otherwise verifies local path.
 * Caller must delete returned tempDir if set.
 */
export async function resolveLocalRestoreArtifact(options: {
  artifactPath: string;
  destinationKind?: string | null;
  destinationS3Profile?: S3ProfileRow | null;
  destinationPeer?: PeerRow | null;
  /** When true (default), decrypt `.age` artifacts with the instance identity */
  decrypt?: boolean;
}): Promise<{ localPath: string; tempDir: string | null }> {
  const kind = options.destinationKind || 'local';
  let localPath: string;
  let tempDir: string | null = null;

  if (kind === 'local') {
    await fs.access(options.artifactPath).catch(() => {
      throw new Error(`Backup artifact not found on disk: ${options.artifactPath}`);
    });
    localPath = options.artifactPath;
  } else if (kind === 's3') {
    if (!options.destinationS3Profile) {
      throw new Error('Destination S3 profile is missing; cannot download artifact');
    }
    const parsed = parseS3ArtifactPath(options.artifactPath);
    if (!parsed) {
      throw new Error(`Invalid S3 artifact path: ${options.artifactPath}`);
    }
    const profile = toS3ProfileConfig(options.destinationS3Profile);
    if (parsed.bucket !== profile.bucket) {
      throw new Error(
        `Artifact bucket ${parsed.bucket} does not match profile bucket ${profile.bucket}`
      );
    }
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-restore-'));
    localPath = path.join(tempDir, path.posix.basename(parsed.key));
    await downloadFile(profile, parsed.key, localPath);
  } else if (kind === 'peer') {
    if (!options.destinationPeer) {
      throw new Error('Destination peer is missing; cannot download artifact');
    }
    const m = options.artifactPath.match(/^peer:\/\/([^/]+)\/(.+)$/);
    if (!m?.[1] || !m[2]) {
      throw new Error(`Invalid peer artifact path: ${options.artifactPath}`);
    }
    const peerId = m[1];
    const objectKey = m[2];
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-restore-'));
    localPath = path.join(tempDir, path.posix.basename(objectKey));

    const peer = options.destinationPeer;
    const transport = peer.transport === 'direct' ? 'direct' : 'mailbox';

    if (transport === 'mailbox') {
      const { stagedObjectExists, peerStagingObjectPath } = await import(
        '@/lib/peer/staging'
      );
      if (await stagedObjectExists(peerId, objectKey)) {
        await fs.copyFile(peerStagingObjectPath(peerId, objectKey), localPath);
      } else {
        // Ask bro to upload back; wait softly (not a critical failure / no webhook)
        const {
          ensureRecall,
          waitForRecall,
          consumeRecallArtifact,
        } = await import('@/lib/peer/recall');
        const recall = await ensureRecall({ peerId, objectKey });
        if (recall.status === 'ready') {
          await consumeRecallArtifact(recall.id, peerId, localPath);
        } else {
          const waited = await waitForRecall(recall.id);
          if (waited.status !== 'ready') {
            throw new Error(
              `Waiting for Bro to connect and return the backup (recall ${recall.id}). This is not a failure — retry when your bro is online.`
            );
          }
          await consumeRecallArtifact(recall.id, peerId, localPath);
        }
      }
    } else {
      await downloadPeerObject(peer, objectKey, localPath);
    }
  } else {
    throw new Error(
      'Restore is only supported when the backup destination is on the LazyBackup host, S3, or a bro peer'
    );
  }

  if (options.decrypt !== false && isAgeEncryptedPath(localPath)) {
    const identities = await requireDecryptIdentities();
    const decryptDir =
      tempDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-decrypt-')));
    if (!tempDir) tempDir = decryptDir;
    const outPath = path.join(decryptDir, stripAgeExtension(path.basename(localPath)));
    await decryptLocalFile(localPath, identities, outPath);
    localPath = outPath;
  }

  return { localPath, tempDir };
}

/**
 * Restore a successful Docker volume backup onto the remote server.
 * Artifact must be local or downloadable from S3.
 */
export async function restoreDockerVolumeBackup(
  historyId: string,
  volumeName?: string
): Promise<{ log: string; volumeName: string }> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    throw new Error('Not in Node.js environment');
  }

  const historyEntry = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.id, historyId),
    with: {
      backupConfig: {
        with: {
          server: true,
          destinationServer: true,
          destinationS3Profile: true,
          destinationPeer: true,
        },
      },
    },
  });

  if (!historyEntry) {
    throw new Error('Backup history entry not found');
  }

  if (historyEntry.status !== 'success') {
    throw new Error('Only successful backups can be restored');
  }

  const config = historyEntry.backupConfig;
  if (!config) {
    throw new Error('Backup configuration not found for this history entry');
  }

  if ((config.sourceType || 'path') !== 'docker_volume') {
    throw new Error('Restore is only supported for Docker volume backups');
  }

  if (!historyEntry.artifactPath) {
    throw new Error('This backup has no stored artifact path and cannot be restored');
  }

  if (!config.server) {
    throw new Error('Source server is missing; cannot restore Docker volume');
  }

  const targetVolume = volumeName?.trim() || config.sourcePath;
  const { localPath: artifactPath, tempDir: downloadTempDir } =
    await resolveLocalRestoreArtifact({
      artifactPath: historyEntry.artifactPath,
      destinationKind: config.destinationKind,
      destinationS3Profile: config.destinationS3Profile,
      destinationPeer: config.destinationPeer,
    });

  const serverConfig = normalizeServer(config.server);

  let ssh: Awaited<ReturnType<typeof connectToServer>> | null = null;
  let cleanupIdentity: (() => Promise<void>) | undefined;
  let remoteTmpDir: string | null = null;

  try {
    ssh = await connectToServer(serverConfig);

    const privateKey = await resolvePrivateKeyForServer(serverConfig);
    const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
    cleanupIdentity = cleanupKeyFile;

    const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(ssh);

    const mktemp = await ssh.execCommand(
      'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" mktemp -d /tmp/lazybackup-docker-XXXXXX'
    );
    if ((mktemp.code !== 0 && mktemp.code !== null && mktemp.code !== undefined) || !mktemp.stdout.trim()) {
      throw new Error(`Failed to create remote temp directory: ${mktemp.stderr || mktemp.stdout}`);
    }
    remoteTmpDir = mktemp.stdout.trim();

    const archiveName = path.basename(artifactPath);
    const remoteTarPath = `${remoteTmpDir}/${archiveName}`;

    const push = await pushFileToRemote({
      localPath: artifactPath,
      remotePath: remoteTarPath,
      username: config.server.username,
      host: config.server.host,
      port: config.server.port,
      identityKeyPath: keyPath,
      rsyncAvailable,
      scpAvailable,
    });

    const restored = await restoreDockerVolume(ssh, targetVolume, remoteTarPath, remoteTmpDir);

    const log = [
      LOG_SECTION.restore,
      '',
      `Volume: ${targetVolume}`,
      `Artifact: ${historyEntry.artifactPath}`,
      downloadTempDir ? 'Downloaded artifact from S3 for restore' : '',
      `Transfer: ${push.method}`,
      push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
      push.stderr?.trim() ? `--- push stderr ---\n${push.stderr.trim()}` : '',
      restored.stdout?.trim() ? `--- extract stdout ---\n${restored.stdout.trim()}` : '',
      restored.stderr?.trim() ? `--- extract stderr ---\n${restored.stderr.trim()}` : '',
      'Restore completed successfully.',
    ]
      .filter(Boolean)
      .join('\n');

    return { log, volumeName: targetVolume };
  } finally {
    if (remoteTmpDir && ssh) {
      await cleanupRemoteDir(ssh, remoteTmpDir).catch(() => {});
    }
    if (downloadTempDir) {
      await fs.rm(downloadTempDir, { recursive: true, force: true }).catch(() => {});
    }
    await cleanupIdentity?.();
    ssh?.dispose();
  }
}

/**
 * Restore a successful database dump onto the source (local or SSH) using config connection settings.
 * Artifact must be local or downloadable from S3.
 */
export async function restoreDatabaseBackup(
  historyId: string,
  databaseName?: string
): Promise<{ log: string; database: string }> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    throw new Error('Not in Node.js environment');
  }

  const historyEntry = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.id, historyId),
    with: {
      backupConfig: {
        with: {
          server: true,
          destinationServer: true,
          destinationS3Profile: true,
          destinationPeer: true,
        },
      },
    },
  });

  if (!historyEntry) {
    throw new Error('Backup history entry not found');
  }

  if (historyEntry.status !== 'success') {
    throw new Error('Only successful backups can be restored');
  }

  const config = historyEntry.backupConfig;
  if (!config) {
    throw new Error('Backup configuration not found for this history entry');
  }

  if ((config.sourceType || 'path') !== 'database') {
    throw new Error('Restore is only supported for database backups');
  }

  if (!historyEntry.artifactPath) {
    throw new Error('This backup has no stored artifact path and cannot be restored');
  }

  const { localPath: artifactPath, tempDir: downloadTempDir } =
    await resolveLocalRestoreArtifact({
      artifactPath: historyEntry.artifactPath,
      destinationKind: config.destinationKind,
      destinationS3Profile: config.destinationS3Profile,
      destinationPeer: config.destinationPeer,
    });

  const dbConn = connectionFromConfig({
    ...config,
    sourcePath: databaseName?.trim() || config.sourcePath,
  });
  const sourceKind = config.sourceKind || 'server';

  try {
    if (sourceKind === 'local') {
      const restored = await restoreDatabaseLocal(dbConn, artifactPath);
      const log = [
        LOG_SECTION.restore,
        '',
        `Engine: ${dbConn.engine}`,
        `Database: ${dbConn.database}`,
        `Client: ${dbConn.client}`,
        `Artifact: ${historyEntry.artifactPath}`,
        downloadTempDir ? 'Downloaded artifact from S3 for restore' : '',
        restored.stdout?.trim() ? `--- restore stdout ---\n${restored.stdout.trim()}` : '',
        restored.stderr?.trim() ? `--- restore stderr ---\n${restored.stderr.trim()}` : '',
        'Restore completed successfully.',
      ]
        .filter(Boolean)
        .join('\n');
      return { log, database: dbConn.database };
    }

    if (!config.server) {
      throw new Error('Source server is missing; cannot restore database');
    }

    const serverConfig = normalizeServer(config.server);
    let ssh: Awaited<ReturnType<typeof connectToServer>> | null = null;
    let cleanupIdentity: (() => Promise<void>) | undefined;
    let remoteTmpDir: string | null = null;

    try {
      ssh = await connectToServer(serverConfig);
      const privateKey = await resolvePrivateKeyForServer(serverConfig);
      const { path: keyPath, cleanup: cleanupKeyFile } =
        await writeTemporarySshIdentityFile(privateKey);
      cleanupIdentity = cleanupKeyFile;
      const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(ssh);

      const mktemp = await ssh.execCommand(
        'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" mktemp -d /tmp/lazybackup-db-XXXXXX'
      );
      if (
        (mktemp.code !== 0 && mktemp.code !== null && mktemp.code !== undefined) ||
        !mktemp.stdout.trim()
      ) {
        throw new Error(`Failed to create remote temp directory: ${mktemp.stderr || mktemp.stdout}`);
      }
      remoteTmpDir = mktemp.stdout.trim();
      const archiveName = path.basename(artifactPath);
      const remoteArchivePath = `${remoteTmpDir}/${archiveName}`;

      const push = await pushFileToRemote({
        localPath: artifactPath,
        remotePath: remoteArchivePath,
        username: config.server.username,
        host: config.server.host,
        port: config.server.port,
        identityKeyPath: keyPath,
        rsyncAvailable,
        scpAvailable,
      });

      const restored = await restoreDatabaseRemote(ssh, dbConn, remoteArchivePath);

      const log = [
        LOG_SECTION.restore,
        '',
        `Engine: ${dbConn.engine}`,
        `Database: ${dbConn.database}`,
        `Client: ${dbConn.client}`,
        `Artifact: ${historyEntry.artifactPath}`,
        downloadTempDir ? 'Downloaded artifact from S3 for restore' : '',
        `Transfer: ${push.method}`,
        push.stdout?.trim() ? `--- push stdout ---\n${push.stdout.trim()}` : '',
        push.stderr?.trim() ? `--- push stderr ---\n${push.stderr.trim()}` : '',
        restored.stdout?.trim() ? `--- restore stdout ---\n${restored.stdout.trim()}` : '',
        restored.stderr?.trim() ? `--- restore stderr ---\n${restored.stderr.trim()}` : '',
        'Restore completed successfully.',
      ]
        .filter(Boolean)
        .join('\n');

      return { log, database: dbConn.database };
    } finally {
      if (remoteTmpDir && ssh) {
        await cleanupRemoteDbTmpDir(ssh, remoteTmpDir).catch(() => {});
      }
      await cleanupIdentity?.();
      ssh?.dispose();
    }
  } finally {
    if (downloadTempDir) {
      await fs.rm(downloadTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function buildFindCommand(remotePath: string, excludePatterns: string[] = []): Promise<string> {
  let findCommand = `find "${remotePath}" -type f -o -type d -name "."`;

  if (excludePatterns.length > 0) {
    const excludeExpressions = excludePatterns
      .map((pattern) => {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return `-not -path "${remotePath}/${regexPattern}"`;
      })
      .join(' ');

    findCommand += ` ${excludeExpressions}`;
  }

  findCommand += ` | sed -e "s|^${remotePath}/||"`;

  return findCommand;
}

async function cleanupOldVersions(baseDir: string, versionsToKeep: number): Promise<void> {
  try {
    let expandedBaseDir = baseDir;
    if (expandedBaseDir.startsWith('~')) {
      expandedBaseDir = expandedBaseDir.replace('~', process.env.HOME || os.homedir());
    }

    if (!(await fs.access(expandedBaseDir).then(() => true).catch(() => false))) {
      console.log(`Directory does not exist, skipping cleanup: ${expandedBaseDir}`);
      return;
    }

    const entries = await fs.readdir(expandedBaseDir, { withFileTypes: true });

    const versionDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((dir) => dir.name)
      .sort()
      .reverse();

    if (versionDirs.length > versionsToKeep) {
      const dirsToDelete = versionDirs.slice(versionsToKeep);

      for (const dir of dirsToDelete) {
        console.log(`Deleting old backup version: ${dir}`);
        await fs.rm(`${expandedBaseDir}/${dir}`, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.error(`Error cleaning up old backup versions: ${error}`);
  }
}

async function cleanupOldFiles(
  destinationPath: string,
  maxAge: number,
  unit: RetentionAgeUnit,
  minKeep: number
): Promise<string[]> {
  try {
    let expandedDir = destinationPath;
    if (expandedDir.startsWith('~')) {
      expandedDir = expandedDir.replace('~', process.env.HOME || os.homedir());
    }
    if (!path.isAbsolute(expandedDir)) {
      expandedDir = path.resolve(expandedDir);
    }

    if (!(await fs.access(expandedDir).then(() => true).catch(() => false))) {
      console.log(`Directory does not exist, skipping file retention: ${expandedDir}`);
      return [];
    }

    const entries = await fs.readdir(expandedDir, { withFileTypes: true });
    const files: { name: string; mtimeMs: number }[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fs.stat(path.join(expandedDir, entry.name));
      files.push({ name: entry.name, mtimeMs: stat.mtimeMs });
    }

    const toDelete = selectFilesToDelete(files, { maxAge, unit, minKeep });

    for (const name of toDelete) {
      console.log(`Deleting old backup file (retention): ${name}`);
      await fs.unlink(path.join(expandedDir, name));
    }

    return toDelete;
  } catch (error) {
    console.error(`Error cleaning up old backup files: ${error}`);
    return [];
  }
}

/**
 * Start a backup for a specific config
 */
export async function startBackup(configId: string): Promise<string> {
  try {
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, configId),
      with: {
        server: true,
        destinationServer: true,
        sourceS3Profile: true,
        destinationS3Profile: true,
        destinationPeer: true,
      },
    });

    if (!config) {
      throw new Error(`Backup configuration with ID ${configId} not found`);
    }

    await assertCanStartBackup(configId);

    const historyEntry = await createBackupHistoryEntry(configId);

    executeBackup(config, historyEntry.id).catch((error) => {
      console.error(`Error executing backup: ${error}`);
    });

    return historyEntry.id;
  } catch (error) {
    console.error('Failed to start backup:', error);
    throw error;
  }
}
