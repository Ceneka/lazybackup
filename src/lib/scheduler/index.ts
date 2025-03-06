import { CronJob } from 'cron';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { backupConfigs, backupHistory } from '../db/schema';
import { connectToServer, executeRsyncCommand } from '../ssh';
import { eq } from 'drizzle-orm';

// Map to store active cron jobs
const activeJobs = new Map<string, CronJob>();

// Initialize the scheduler
export async function initializeScheduler() {
  console.log('Initializing backup scheduler...');
  
  // Get all enabled backup configurations
  const configs = await db.query.backupConfigs.findMany({
    where: eq(backupConfigs.enabled, true),
    with: {
      server: true,
    },
  });
  
  // Schedule each backup
  configs.forEach(config => {
    scheduleBackup(config);
  });
  
  console.log(`Scheduled ${configs.length} backup jobs`);
}

// Schedule a single backup
export function scheduleBackup(config: any) {
  // Cancel existing job if it exists
  if (activeJobs.has(config.id)) {
    activeJobs.get(config.id)?.stop();
    activeJobs.delete(config.id);
  }
  
  // Create a new cron job
  const job = new CronJob(
    config.schedule,
    () => runBackup(config),
    null,
    true
  );
  
  // Store the job
  activeJobs.set(config.id, job);
  
  console.log(`Scheduled backup job for ${config.name} with schedule ${config.schedule}`);
}

// Run a backup
export async function runBackup(config: any) {
  console.log(`Running backup for ${config.name}...`);
  
  // Create a backup history record
  const historyId = nanoid();
  await db.insert(backupHistory).values({
    id: historyId,
    configId: config.id,
    startTime: new Date(),
    status: 'running',
  });
  
  try {
    // Validate required paths
    if (!config.sourcePath) {
      throw new Error('Source path is not configured');
    }
    
    if (!config.destinationPath) {
      throw new Error('Destination path is not configured');
    }
    
    // Connect to the server
    const ssh = await connectToServer(config.server);
    
    // Parse exclude patterns
    const excludePatterns = config.excludePatterns 
      ? JSON.parse(config.excludePatterns) 
      : [];
    
    // Execute the rsync command
    const result = await executeRsyncCommand(
      ssh,
      config.sourcePath,
      config.destinationPath,
      excludePatterns
    );
    
    // Parse rsync output to get statistics
    const stats = parseRsyncStats(result.stdout);
    
    // Update the backup history record
    await db.update(backupHistory)
      .set({
        endTime: new Date(),
        status: 'success',
        fileCount: stats.fileCount,
        totalSize: stats.totalSize,
        transferredSize: stats.transferredSize,
        logOutput: result.stdout,
      })
      .where(eq(backupHistory.id, historyId));
    
    // Close the SSH connection
    ssh.dispose();
    
    console.log(`Backup completed successfully for ${config.name}`);
  } catch (error) {
    console.error(`Backup failed for ${config.name}:`, error);
    
    // Update the backup history record with the error
    await db.update(backupHistory)
      .set({
        endTime: new Date(),
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(backupHistory.id, historyId));
  }
}

// Parse rsync statistics from output
function parseRsyncStats(output: string): { fileCount: number; totalSize: number; transferredSize: number } {
  const fileCountMatch = output.match(/Number of files: (\d+)/);
  const totalSizeMatch = output.match(/Total file size: (\d+)/);
  const transferredSizeMatch = output.match(/Total transferred file size: (\d+)/);
  
  return {
    fileCount: fileCountMatch ? parseInt(fileCountMatch[1], 10) : 0,
    totalSize: totalSizeMatch ? parseInt(totalSizeMatch[1], 10) : 0,
    transferredSize: transferredSizeMatch ? parseInt(transferredSizeMatch[1], 10) : 0,
  };
} 
