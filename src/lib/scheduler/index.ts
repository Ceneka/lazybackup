import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { backupConfigs, backupHistory } from '../db/schema';

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

// Function to restart the scheduler
export async function restartScheduler() {
  console.log('Restarting backup scheduler...');
  
  // Stop all active jobs
  activeJobs.forEach((job, id) => {
    try {
      job.stop();
      console.log(`Stopped job ${id}`);
    } catch (error) {
      console.error(`Error stopping job ${id}:`, error);
    }
  });
  
  // Clear the jobs map
  activeJobs.clear();
  
  // Re-initialize the scheduler
  await initializeScheduler();
  
  console.log('Scheduler restarted successfully');
  return true;
}

// Stop a scheduled backup
export function stopBackup(backupId: string): boolean {
  if (activeJobs.has(backupId)) {
    try {
      const job = activeJobs.get(backupId);
      job?.stop();
      activeJobs.delete(backupId);
      console.log(`Stopped and removed backup job for ID ${backupId}`);
      return true;
    } catch (error) {
      console.error(`Error stopping backup job for ID ${backupId}:`, error);
      return false;
    }
  }
  console.log(`No active job found for backup ID ${backupId}`);
  return false;
}

// Schedule a single backup
export function scheduleBackup(config: any) {
  // Cancel existing job if it exists
  stopBackup(config.id);
  
  // Create a new cron job
  try {
    const job = new CronJob(
      config.schedule,
      () => runBackup(config),
      null,
      true
    );
    
    // Store the job
    activeJobs.set(config.id, job);
    
    console.log(`Scheduled backup job for ${config.name} (${config.id}) with schedule ${config.schedule}`);
  } catch (error) {
    console.error(`Failed to schedule backup job for ${config.name} (${config.id}):`, error);
  }
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
    // Import the executeBackup function from the backup module
    const { executeBackup } = await import('../backup');
    
    // Execute the backup using the unified implementation
    await executeBackup(config, historyId);
    
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

