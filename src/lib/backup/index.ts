import { NodeSSH } from 'node-ssh';
import { db } from '@/lib/db';
import { backupHistory, backupConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { updateBackupHistorySuccess, updateBackupHistoryFailure, createBackupHistoryEntry } from './history';

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
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'key';
    password?: string | null;
    privateKey?: string | null;
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
    
    // Connect to the server
    const ssh = new NodeSSH();
    
    // Connect based on auth type
    if (config.server.authType === 'password' && config.server.password) {
      await ssh.connect({
        host: config.server.host,
        port: config.server.port,
        username: config.server.username,
        password: config.server.password,
      });
    } else if (config.server.authType === 'key' && config.server.privateKey) {
      await ssh.connect({
        host: config.server.host,
        port: config.server.port,
        username: config.server.username,
        privateKey: config.server.privateKey,
      });
    } else {
      throw new Error('Invalid authentication configuration');
    }
    
    // Parse exclude patterns
    const excludePatterns = config.excludePatterns 
      ? config.excludePatterns.split('\n').filter(Boolean) 
      : [];
    
    // Build the rsync command
    let rsyncCommand = `rsync -avz --stats`;
    
    // Add exclude patterns
    if (excludePatterns.length > 0) {
      excludePatterns.forEach(pattern => {
        rsyncCommand += ` --exclude="${pattern}"`;
      });
    }
    
    // Add source and destination
    rsyncCommand += ` ${config.sourcePath} ${config.destinationPath}`;
    
    // Execute the command
    const result = await ssh.execCommand(rsyncCommand);
    
    // Parse the rsync output to get stats
    const fileCount = parseFileCount(result.stdout);
    const totalSize = parseTotalSize(result.stdout);
    const transferredSize = parseTransferredSize(result.stdout);
    
    // Update the history entry with success status
    await updateBackupHistorySuccess(historyId, {
      fileCount,
      totalSize,
      transferredSize,
      logOutput: result.stdout,
    });
    
    // Close the SSH connection
    ssh.dispose();
    
    console.log(`Backup completed successfully: ${config.name} (${historyId})`);
  } catch (error) {
    console.error(`Backup failed: ${config.name} (${historyId})`, error);
    
    // Update the history entry with failure status
    await updateBackupHistoryFailure(historyId, error instanceof Error ? error : String(error));
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
