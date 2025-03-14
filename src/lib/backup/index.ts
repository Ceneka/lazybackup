import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { buildRsyncCommand } from '@/lib/ssh/rsync';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { Stats } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseRsyncOutput } from '../utils/rsync-parser';
import { createBackupHistoryEntry, updateBackupHistoryFailure, updateBackupHistorySuccess } from './history';

// Type for backup config with server
type BackupConfigWithServer = {
  id: string;
  serverId: string;
  name: string;
  sourcePath: string;
  destinationPath: string;
  schedule: string;
  excludePatterns?: string | null;
  preBackupCommands?: string | null;
  enabled: boolean;
  enableVersioning: boolean;
  versionsToKeep?: number | null;
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

/**
 * Execute a backup based on its configuration
 */
export async function executeBackup(config: BackupConfigWithServer, historyId: string): Promise<void> {
  try {
    console.log(`Starting backup: ${config.name} (${historyId})`);

    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      throw new Error('Not in Node.js environment');
    }

    // Import the SSH utilities to use the connectToServer function
    const { connectToServer } = await import('@/lib/ssh');

    // Ensure server object has all required fields for the Server type
    const serverConfig = {
      ...config.server,
      password: config.server.password || null,
      privateKey: config.server.privateKey || null,
      sshKeyId: config.server.sshKeyId || null,
      systemKeyPath: config.server.systemKeyPath || null
    };

    // Connect to the server using the comprehensive connection function
    const ssh = await connectToServer(serverConfig);

    // Run pre-backup commands if specified
    if (config.preBackupCommands && config.preBackupCommands.trim()) {
      console.log(`Running pre-backup commands for ${config.name}`);
      const commands = config.preBackupCommands.split('\n').filter(Boolean);

      for (const command of commands) {
        console.log(`Executing command: ${command}`);
        const result = await ssh.execCommand(command);

        if (result.stderr) {
          console.warn(`Command produced warnings/errors: ${result.stderr}`);
        }

        console.log(`Command output: ${result.stdout || 'No output'}`);
      }

      console.log(`Completed pre-backup commands for ${config.name}`);
    }

    // Parse exclude patterns
    const excludePatterns = config.excludePatterns
      ? config.excludePatterns.split('\n').filter(Boolean)
      : [];

    // Generate timestamp for versioned backup
    const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');

    // Determine backup destination
    let backupDestination = config.destinationPath;

    // Expand tilde in destination path
    if (backupDestination.startsWith('~')) {
      backupDestination = backupDestination.replace('~', process.env.HOME || os.homedir());
    }

    // Ensure destination path is absolute
    if (!path.isAbsolute(backupDestination)) {
      backupDestination = path.resolve(backupDestination);
    }

    // Check if versioning is enabled
    if (config.enableVersioning) {
      backupDestination = path.join(backupDestination, timestamp);

      // Create the destination directory if it doesn't exist
      await fs.mkdir(backupDestination, { recursive: true });
    } else {
      // Create the destination directory if it doesn't exist
      await fs.mkdir(backupDestination, { recursive: true });
    }

    // Use username@host:path format for the source
    let remotePath = config.sourcePath;

    // Keep the tilde for the remote path as it will be expanded on the server
    const remoteSource = `${config.server.username}@${config.server.host}:${remotePath}/`;

    // Check if rsync is available on the server
    const rsyncCheckResult = await ssh.execCommand('which rsync || echo "not_found"');
    const isRsyncAvailable = !rsyncCheckResult.stdout.includes('not_found') && rsyncCheckResult.stderr === '';

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    let backupResult;
    let usedMethod = 'rsync';

    if (isRsyncAvailable) {
      // Use rsync if it's available
      console.log('Using rsync for backup');

      // Build the rsync command to pull data FROM the server TO the local machine using the utility
      const rsyncCommand = buildRsyncCommand(remoteSource, backupDestination, excludePatterns);
      console.log(`Executing rsync command: ${rsyncCommand}`);

      // Execute rsync locally to pull data from the remote server
      backupResult = await execPromise(rsyncCommand);
    } else {
      // Fall back to SCP if rsync is not available
      console.log('Rsync not available on server, falling back to SCP');
      usedMethod = 'scp';

      // For SCP, we need to handle exclude patterns differently
      // We'll use the SSH connection to list files while excluding the patterns, then download each file

      // First, create a temporary script with the file list command
      const findCommand = await buildFindCommand(remotePath, excludePatterns);

      // Execute the find command to get a list of files
      const fileListResult = await ssh.execCommand(findCommand);
      const filesToCopy = fileListResult.stdout.split('\n').filter(Boolean);

      console.log(`Found ${filesToCopy.length} files/directories to copy via SCP`);

      if (filesToCopy.length === 0) {
        console.log('No files to copy, skipping backup');
        throw new Error('No files to copy, skipping backup');
      }

      // Use SCP to download all files
      const scpPromises = [];
      let transferredFiles = 0;
      let totalSize = 0;

      for (const filePath of filesToCopy) {
        // For directories, we need to create them locally first
        if (filePath.endsWith('/')) {
          const localDirPath = path.join(backupDestination, filePath);
          await fs.mkdir(localDirPath, { recursive: true });
          continue;
        }

        // For files, use SCP to download
        const relativeFilePath = filePath;
        const remoteFilePath = path.join(remotePath, relativeFilePath);
        const localFilePath = path.join(backupDestination, relativeFilePath);

        // Create parent directory if it doesn't exist
        await fs.mkdir(path.dirname(localFilePath), { recursive: true });

        // Build SCP command
        const scpCommand = `scp -P ${config.server.port} ${config.server.username}@${config.server.host}:"${remoteFilePath}" "${localFilePath}"`;

        scpPromises.push(
          execPromise(scpCommand)
            .then(() => {
              transferredFiles++;
              return fs.stat(localFilePath);
            })
            .then((stats: Stats) => {
              totalSize += stats.size;
            })
            .catch((err: Error) => {
              console.error(`Error copying file ${remoteFilePath}:`, err);
            })
        );
      }

      // Wait for all SCP operations to complete
      await Promise.all(scpPromises);

      // Create a simulated result object similar to rsync output
      const scpOutput = `SCP Backup Summary:
Number of files: ${transferredFiles}
Total file size: ${totalSize}
Total transferred file size: ${totalSize}`;

      backupResult = { stdout: scpOutput, stderr: '' };
    }

    console.log(`Backup completed for ${config.name} using ${usedMethod}`);

    // Clean up old versions if versioning is enabled
    if (config.enableVersioning && config.versionsToKeep) {
      // Extract the base directory from backupDestination when versioning is enabled
      const baseDir = config.enableVersioning
        ? path.dirname(backupDestination)
        : config.destinationPath;

      await cleanupOldVersions(baseDir, config.versionsToKeep);
    }

    // Update backup history with success
    const parsedOutput = parseRsyncOutput(backupResult.stdout);

    await updateBackupHistorySuccess(
      historyId,
      {
        ...parsedOutput,
        logOutput: backupResult.stdout
      }
    );

    // Dispose of the SSH connection
    ssh.dispose();
  } catch (error) {
    console.error(`Backup failed: ${error}`);
    await updateBackupHistoryFailure(
      historyId,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Builds a find command to list files on the remote server while respecting exclude patterns
 */
async function buildFindCommand(remotePath: string, excludePatterns: string[] = []): Promise<string> {
  let findCommand = `find "${remotePath}" -type f -o -type d -name "."`;

  // Add exclude patterns to the find command
  if (excludePatterns.length > 0) {
    const excludeExpressions = excludePatterns
      .map(pattern => {
        // Convert glob patterns to regex patterns for find
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');

        return `-not -path "${remotePath}/${regexPattern}"`;
      })
      .join(' ');

    findCommand += ` ${excludeExpressions}`;
  }

  // Print relative paths
  findCommand += ` | sed -e "s|^${remotePath}/||"`;

  return findCommand;
}

// Function to clean up old versions
async function cleanupOldVersions(baseDir: string, versionsToKeep: number): Promise<void> {
  try {
    // Expand tilde in base directory path if it exists
    let expandedBaseDir = baseDir;
    if (expandedBaseDir.startsWith('~')) {
      expandedBaseDir = expandedBaseDir.replace('~', process.env.HOME || os.homedir());
    }

    // Ensure the directory exists before attempting to read it
    if (!await fs.access(expandedBaseDir).then(() => true).catch(() => false)) {
      console.log(`Directory does not exist, skipping cleanup: ${expandedBaseDir}`);
      return;
    }

    // Read all directories in the base directory
    const entries = await fs.readdir(expandedBaseDir, { withFileTypes: true });

    // Filter for directories and sort by name (timestamp) in descending order
    const versionDirs = entries
      .filter(entry => entry.isDirectory())
      .map(dir => dir.name)
      .sort()
      .reverse();

    // If we have more versions than we want to keep
    if (versionDirs.length > versionsToKeep) {
      // Get directories to delete (oldest ones)
      const dirsToDelete = versionDirs.slice(versionsToKeep);

      // Delete each directory
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
 * Start a backup for a specific config
 * Creates a history entry and executes the backup
 */
export async function startBackup(configId: string): Promise<string> {
  try {
    // Get the backup configuration with server details
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, configId),
      with: {
        server: true,
      },
    });

    if (!config) {
      throw new Error(`Backup configuration with ID ${configId} not found`);
    }

    // Create a new history entry
    const historyEntry = await createBackupHistoryEntry(configId);

    // Execute the backup in the background
    executeBackup(config, historyEntry.id).catch(error => {
      console.error(`Error executing backup: ${error}`);
    });

    return historyEntry.id;
  } catch (error) {
    console.error('Failed to start backup:', error);
    throw error;
  }
} 
