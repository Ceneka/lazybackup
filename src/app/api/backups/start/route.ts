import { startBackup } from '@/lib/backup';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/backups/start - Start a new backup process
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.configId) {
      return NextResponse.json(
        { error: 'Required field missing: configId is required' },
        { status: 400 }
      );
    }

    // Start the backup
    const historyId = await startBackup(body.configId);

    return NextResponse.json({
      message: 'Backup started successfully',
      historyId,
    }, { status: 201 });
  } catch (error) {
    console.error('Error starting backup:', error);
    return NextResponse.json(
      { error: 'Failed to start backup', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 
