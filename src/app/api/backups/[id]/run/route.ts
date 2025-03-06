import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { backupConfigs, backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeBackup } from '@/lib/backup';

// POST /api/backups/:id/run - Run a backup manually
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
    // Get the backup configuration
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        server: true,
      },
    });
    
    if (!config) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }
    
    // Create a history entry for this backup execution
    const historyEntry = {
      id: nanoid(),
      configId: config.id,
      startTime: new Date(),
      status: 'running' as const,
    };
    
    await db.insert(backupHistory).values(historyEntry);
    
    // Execute the backup asynchronously
    executeBackup(config, historyEntry.id).catch(error => {
      console.error(`Backup execution failed for ${config.name}:`, error);
    });
    
    return NextResponse.json({
      success: true,
      message: 'Backup started successfully',
      historyId: historyEntry.id,
    });
  } catch (error) {
    console.error('Failed to run backup:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run backup',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 
