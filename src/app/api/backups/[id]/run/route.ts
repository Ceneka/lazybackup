import { executeBackup } from '@/lib/backup';
import { createBackupHistoryEntry } from '@/lib/backup/history';
import {
  assertCanStartBackup,
  isBackupAlreadyRunningError,
} from '@/lib/backup/concurrent-run';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/backups/:id/run - Run a backup manually
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the backup configuration
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        server: true,
        destinationServer: true,
        sourceS3Profile: true,
        destinationS3Profile: true,
      },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }

    try {
      await assertCanStartBackup(config.id);
    } catch (error) {
      if (isBackupAlreadyRunningError(error)) {
        return NextResponse.json(
          {
            error: error.message,
            historyId: error.historyId,
          },
          { status: 409 }
        );
      }
      throw error;
    }

    const historyEntry = await createBackupHistoryEntry(config.id, {
      backupName: config.name,
    });

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
