import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { buildRsyncCommand } from '@/lib/ssh/rsync';
import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
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
    
    // Build the rsync command to pull data FROM the server TO the local machine using the utility
    const rsyncCommand = buildRsyncCommand(remoteSource, backupDestination, excludePatterns);
    
    console.log(`Executing rsync command: ${rsyncCommand}`);
    
    // Since we can't use NodeSSH to run rsync properly from remote to local, use local exec
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);
    
    // Execute rsync locally to pull data from the remote server
    const rsyncResult = await execPromise(rsyncCommand);
    
    console.log(`Backup completed for ${config.name}`);
    
    // Clean up old versions if versioning is enabled
    if (config.enableVersioning && config.versionsToKeep) {
      // Extract the base directory from backupDestination when versioning is enabled
      const baseDir = config.enableVersioning 
        ? path.dirname(backupDestination) 
        : config.destinationPath;
      
      await cleanupOldVersions(baseDir, config.versionsToKeep);
    }
    
    // Update backup history with success
    const parsedOutput = parseRsyncOutput(rsyncResult.stdout);
    
    await updateBackupHistorySuccess(
      historyId,
      {
        ...parsedOutput,
        logOutput: rsyncResult.stdout
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
 * Parse the number of files from rsync output
 */
function parseFileCount(output: string): number {
  const match = output.match(/Number of files: ([\d,]+)/);
  if (match && match[1]) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return 0;
}

/**
 * Parse the total size from rsync output
 */
function parseTotalSize(output: string): number {
  const match = output.match(/Total file size: ([\d,]+)/);
  if (match && match[1]) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return 0;
}

/**
 * Parse the transferred size from rsync output
 */
function parseTransferredSize(output: string): number {
  const match = output.match(/Total transferred file size: ([\d,]+)/);
  if (match && match[1]) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return 0;
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
