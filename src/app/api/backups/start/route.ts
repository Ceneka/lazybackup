import { startBackup } from '@/lib/backup';
import { isBackupStartConflictError } from '@/lib/backup/concurrent-run';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

const CONFIG_NOT_FOUND = 'Backup configuration not found';

/**
 * POST /api/backups/start - Start a new backup process
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const configId =
    typeof body === 'object' && body !== null
      ? (body as { configId?: unknown }).configId
      : undefined;
  if (typeof configId !== 'string' || !configId.trim()) {
    return NextResponse.json({ error: CONFIG_NOT_FOUND }, { status: 404 });
  }

  try {
    // Answer unknown ids as 404 before startBackup's generic "not found" throw,
    // which the catch below would otherwise report as a 500.
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, configId),
      columns: { id: true },
    });
    if (!config) {
      return NextResponse.json({ error: CONFIG_NOT_FOUND }, { status: 404 });
    }

    // Start the backup
    const historyId = await startBackup(configId);

    return NextResponse.json({
      message: 'Backup started successfully',
      historyId,
    }, { status: 201 });
  } catch (error) {
    if (isBackupStartConflictError(error)) {
      return NextResponse.json(
        { error: error.message, historyId: error.historyId },
        { status: 409 }
      );
    }
    console.error('Error starting backup:', error);
    return NextResponse.json(
      { error: 'Failed to start backup', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
