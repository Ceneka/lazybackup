import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { scheduleBackup, stopBackup } from '@/lib/scheduler';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/backups/:id/toggle - Toggle the enabled status of a backup
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    // Get the current backup configuration
    const currentConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        server: true,
      },
    });
    
    if (!currentConfig) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }
    
    // Toggle the enabled status
    const newEnabledStatus = !currentConfig.enabled;
    
    // Update the backup configuration
    await db.update(backupConfigs)
      .set({
        enabled: newEnabledStatus,
        updatedAt: new Date(),
      })
      .where(eq(backupConfigs.id, id));
    
    // Handle scheduling based on new status
    if (newEnabledStatus) {
      // If enabling, schedule the backup
      scheduleBackup(currentConfig);
    } else {
      // If disabling, stop the backup job
      stopBackup(id);
    }
    
    // Get the updated configuration
    const updatedConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        server: true,
      },
    });
    
    return NextResponse.json(updatedConfig);
  } catch (error) {
    console.error('Failed to toggle backup status:', error);
    return NextResponse.json(
      { error: 'Failed to toggle backup status' },
      { status: 500 }
    );
  }
} 
