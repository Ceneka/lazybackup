import { db } from '@/lib/db';
import { backupConfigs, backupHistory } from '@/lib/db/schema';
import {
  cleanupRemoteDir,
  packDockerVolume,
  restoreDockerVolume,
} from '@/lib/docker/volumes';
import {
  connectToServer,
  getBackupTransportCapabilities,
  pullFileFromRemote,
  pushFileToRemote,
  resolvePrivateKeyForServer,
  writeTemporarySshIdentityFile,
} from '@/lib/ssh';
import { buildRsyncCommand, shellSingleQuote } from '@/lib/ssh/rsync';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { Stats } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseRsyncOutput } from '../utils/rsync-parser';
import { selectFilesToDelete, type RetentionAgeUnit } from './file-retention';
import { createBackupHistoryEntry, updateBackupHistoryFailure, updateBackupHistorySuccess } from './history';
import {
  buildFileRetentionLog,
  buildPreBackupLog,
  combineBackupLog,
  formatPreBackupCommandLog,
  LOG_SECTION,
} from './log-format';

// Type for backup config with server
type BackupConfigWithServer = {
  id: string;
  serverId: string;
  name: string;
  sourceType?: 'path' | 'docker_volume' | null;
  sourcePath: string;
  destinationPath: string;
  schedule: string;
  excludePatterns?: string | null;
  preBackupCommands?: string | null;
  enabled: boolean;
  enableVersioning: boolean;
  versionsToKeep?: number | null;
  enableFileRetention?: boolean | null;
  retentionMaxAge?: number | null;
  retentionMaxAgeUnit?: RetentionAgeUnit | null;
  retentionMinKeep?: number | null;
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'key';
    password?: string | null;
    privateKey?: string | null;
    sshKeyId?: string | null;
    systemKeyPath?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

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

/**
 * Execute a backup based on its configuration
 */
export async function executeBackup(config: BackupConfigWithServer, historyId: string): Promise<void> {
  let ssh: Awaited<ReturnType<typeof connectToServer>> | null = null;
  let cleanupIdentity: (() => Promise<void>) | undefined;
  let preBackupLog = '';
  let remoteTmpDir: string | null = null;

  try {
    console.log(`Starting backup: ${config.name} (${historyId})`);

    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      throw new Error('Not in Node.js environment');
    }

    const serverConfig = {
      ...config.server,
      password: config.server.password || null,
      privateKey: config.server.privateKey || null,
      sshKeyId: config.server.sshKeyId || null,
      systemKeyPath: config.server.systemKeyPath || null
    };

    ssh = await connectToServer(serverConfig);

    if (config.preBackupCommands && config.preBackupCommands.trim()) {
      console.log(`Running pre-backup commands for ${config.name}`);
      const commands = config.preBackupCommands.split('\n').filter(Boolean);
      const commandLogs: string[] = [];

      for (const command of commands) {
        console.log(`Executing command: ${command}`);
        const result = await ssh.execCommand(command);
        const commandLog = formatPreBackupCommandLog(command, result);
        commandLogs.push(commandLog);

        if (result.stderr) {
          console.warn(`Command produced warnings/errors: ${result.stderr}`);
        }

        console.log(`Command output: ${result.stdout || 'No output'}`);
      }

      preBackupLog = buildPreBackupLog(commandLogs);
      console.log(`Completed pre-backup commands for ${config.name}`);
    }

    const excludePatterns = config.excludePatterns
      ? config.excludePatterns.split('\n').filter(Boolean)
      : [];

    const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');

    let backupDestination = expandLocalPath(config.destinationPath);

    if (config.enableVersioning) {
      backupDestination = path.join(backupDestination, timestamp);
    }

    await fs.mkdir(backupDestination, { recursive: true });

    const privateKey = await resolvePrivateKeyForServer(serverConfig);
    const { path: keyPath, cleanup: cleanupKeyFile } = await writeTemporarySshIdentityFile(privateKey);
    cleanupIdentity = cleanupKeyFile;

    const localSshShell = `ssh -p ${config.server.port} -i ${shellSingleQuote(keyPath)} -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;

    const { rsyncAvailable, scpAvailable } = await getBackupTransportCapabilities(ssh);

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    const sourceType = config.sourceType || 'path';
    let backupResult: { stdout: string; stderr: string };
    let usedMethod: 'rsync' | 'scp' | 'docker' = 'rsync';
    let artifactPath = backupDestination;

    if (sourceType === 'docker_volume') {
      console.log(`Packing Docker volume: ${config.sourcePath}`);
      const packed = await packDockerVolume(ssh, config.sourcePath, excludePatterns);
      remoteTmpDir = packed.remoteTmpDir;

      const archiveName = `${config.sourcePath}.tar.gz`;
      const localArchivePath = path.join(backupDestination, archiveName);

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
      const dockerLog = [
        `Volume: ${config.sourcePath}`,
        `Archive: ${archiveName}`,
        `Local path: ${localArchivePath}`,
        `Size: ${stats.size} bytes`,
        `Transfer: ${pull.method}`,
        packed.stdout?.trim() ? `--- pack stdout ---\n${packed.stdout.trim()}` : '',
        packed.stderr?.trim() ? `--- pack stderr ---\n${packed.stderr.trim()}` : '',
        pull.stdout?.trim() ? `--- transfer stdout ---\n${pull.stdout.trim()}` : '',
        pull.stderr?.trim() ? `--- transfer stderr ---\n${pull.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      backupResult = { stdout: dockerLog, stderr: '' };
    } else {
      const remotePath = config.sourcePath;
      const remoteSource = `${config.server.username}@${config.server.host}:${remotePath}/`;

      if (rsyncAvailable) {
        console.log('Using rsync for backup (preferred path)');

        const rsyncCommand = buildRsyncCommand(
          remoteSource,
          backupDestination,
          excludePatterns,
          [],
          localSshShell
        );
        console.log(`Executing rsync command: ${rsyncCommand}`);

        backupResult = await execPromise(rsyncCommand);
      } else if (scpAvailable) {
        console.log('Rsync not on remote host — falling back to local SCP');
        usedMethod = 'scp';

        const findCommand = await buildFindCommand(remotePath, excludePatterns);
        const fileListResult = await ssh.execCommand(findCommand);
        const filesToCopy = fileListResult.stdout.split('\n').filter(Boolean);

        console.log(`Found ${filesToCopy.length} files/directories to copy via SCP`);

        if (filesToCopy.length === 0) {
          console.log('No files to copy, skipping backup');
          throw new Error('No files to copy, skipping backup');
        }

        const scpPromises = [];
        let transferredFiles = 0;
        let totalSize = 0;

        for (const filePath of filesToCopy) {
          if (filePath.endsWith('/')) {
            const localDirPath = path.join(backupDestination, filePath);
            await fs.mkdir(localDirPath, { recursive: true });
            continue;
          }

          const relativeFilePath = filePath;
          const remoteFilePath = path.join(remotePath, relativeFilePath);
          const localFilePath = path.join(backupDestination, relativeFilePath);

          await fs.mkdir(path.dirname(localFilePath), { recursive: true });

          const scpOpts = `-P ${config.server.port} -F /dev/null -i ${shellSingleQuote(keyPath)} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
          const scpCommand = `scp ${scpOpts} ${config.server.username}@${config.server.host}:"${remoteFilePath}" "${localFilePath}"`;

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

        const scpOutput = `SCP Backup Summary:
Number of files: ${transferredFiles}
Total file size: ${totalSize}
Total transferred file size: ${totalSize}`;

        backupResult = { stdout: scpOutput, stderr: '' };
      } else {
        throw new Error(
          'Cannot run backup: rsync was not found on the remote host and the SCP client was not found on this machine.'
        );
      }
    }

    if (remoteTmpDir && ssh) {
      await cleanupRemoteDir(ssh, remoteTmpDir).catch((err) =>
        console.warn(`Failed to clean remote temp dir: ${err}`)
      );
      remoteTmpDir = null;
    }

    console.log(`Backup completed for ${config.name} using ${usedMethod}`);

    if (config.enableVersioning && config.versionsToKeep) {
      const baseDir = path.dirname(backupDestination);
      await cleanupOldVersions(baseDir, config.versionsToKeep);
    }

    let fileRetentionLog = '';
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

    const parsedOutput =
      usedMethod === 'docker'
        ? {
            fileCount: 1,
            totalSize: (await fs.stat(artifactPath)).size,
            transferredSize: (await fs.stat(artifactPath)).size,
          }
        : parseRsyncOutput(backupResult.stdout);

    await updateBackupHistorySuccess(historyId, {
      ...parsedOutput,
      logOutput: combineBackupLog(preBackupLog, backupResult.stdout, usedMethod, fileRetentionLog),
      artifactPath,
    });
  } catch (error) {
    console.error(`Backup failed: ${error}`);
    if (remoteTmpDir && ssh) {
      await cleanupRemoteDir(ssh, remoteTmpDir).catch(() => {});
    }
    await updateBackupHistoryFailure(
      historyId,
      error instanceof Error ? error.message : 'Unknown error',
      preBackupLog ? { logOutput: preBackupLog } : undefined
    );
    throw error;
  } finally {
    await cleanupIdentity?.();
    ssh?.dispose();
  }
}

/**
 * Restore a successful Docker volume backup onto the remote server.
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

  const targetVolume = volumeName?.trim() || config.sourcePath;
  const artifactPath = historyEntry.artifactPath;

  await fs.access(artifactPath).catch(() => {
    throw new Error(`Backup artifact not found on disk: ${artifactPath}`);
  });

  const serverConfig = {
    ...config.server,
    password: config.server.password || null,
    privateKey: config.server.privateKey || null,
    sshKeyId: config.server.sshKeyId || null,
    systemKeyPath: config.server.systemKeyPath || null,
  };

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
      `Artifact: ${artifactPath}`,
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
    await cleanupIdentity?.();
    ssh?.dispose();
  }
}

/**
 * Builds a find command to list files on the remote server while respecting exclude patterns
 */
async function buildFindCommand(remotePath: string, excludePatterns: string[] = []): Promise<string> {
  let findCommand = `find "${remotePath}" -type f -o -type d -name "."`;

  if (excludePatterns.length > 0) {
    const excludeExpressions = excludePatterns
      .map(pattern => {
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

    if (!await fs.access(expandedBaseDir).then(() => true).catch(() => false)) {
      console.log(`Directory does not exist, skipping cleanup: ${expandedBaseDir}`);
      return;
    }

    const entries = await fs.readdir(expandedBaseDir, { withFileTypes: true });

    const versionDirs = entries
      .filter(entry => entry.isDirectory())
      .map(dir => dir.name)
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

/**
 * Delete top-level files in destination older than max age, keeping at least minKeep newest.
 * Returns names of deleted files. Soft-fails (logs and returns []) on error.
 */
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

    if (!await fs.access(expandedDir).then(() => true).catch(() => false)) {
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
 * Creates a history entry and executes the backup
 */
export async function startBackup(configId: string): Promise<string> {
  try {
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, configId),
      with: {
        server: true,
      },
    });

    if (!config) {
      throw new Error(`Backup configuration with ID ${configId} not found`);
    }

    const historyEntry = await createBackupHistoryEntry(configId);

    executeBackup(config, historyEntry.id).catch(error => {
      console.error(`Error executing backup: ${error}`);
    });

    return historyEntry.id;
  } catch (error) {
    console.error('Failed to start backup:', error);
    throw error;
  }
}
