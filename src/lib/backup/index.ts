import { NodeSSH } from 'node-ssh';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
    await db.update(backupHistory)
      .set({
        endTime: new Date(),
        status: 'success',
        fileCount,
        totalSize,
        transferredSize,
        logOutput: result.stdout,
      })
      .where(eq(backupHistory.id, historyId));
    
    // Close the SSH connection
    ssh.dispose();
    
    console.log(`Backup completed successfully: ${config.name} (${historyId})`);
  } catch (error) {
    console.error(`Backup failed: ${config.name} (${historyId})`, error);
    
    // Update the history entry with failure status
    await db.update(backupHistory)
      .set({
        endTime: new Date(),
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(backupHistory.id, historyId));
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
