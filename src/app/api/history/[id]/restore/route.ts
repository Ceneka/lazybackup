import { restoreDatabaseBackup, restoreDockerVolumeBackup, restorePathBackup } from '@/lib/backup';
import {
  RESTORE_CONFIRM_REQUIRED,
  hasRestoreConfirm,
  restoreHistorySchema,
} from '@/lib/backup/history-schema';
import { isValidDockerVolumeName } from '@/lib/docker/volumes';
import { DB_NAME_RE } from '@/lib/database';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { PeerRecallPendingError, peerRecallWaitingResponse } from '@/lib/peer/recall';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// POST /api/history/[id]/restore — restore path tree, Docker volume, or database dump
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (!hasRestoreConfirm(body)) {
      return NextResponse.json(
        { error: RESTORE_CONFIRM_REQUIRED },
        { status: 400 }
      );
    }
    const { volumeName, databaseName, targetPath, allowRetarget } =
      restoreHistorySchema.parse(body);

    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: { backupConfig: { columns: { sourceType: true } } },
    });

    if (!historyEntry) {
      return NextResponse.json({ error: 'Backup history entry not found' }, { status: 404 });
    }

    const sourceType = historyEntry.backupConfig?.sourceType || 'path';

    if (sourceType === 'database') {
      if (databaseName && !DB_NAME_RE.test(databaseName)) {
        return NextResponse.json({ error: 'Invalid database name' }, { status: 400 });
      }
      const result = await restoreDatabaseBackup(id, {
        databaseName,
        confirm: true,
        allowRetarget,
      });
      return NextResponse.json({
        success: true,
        database: result.database,
        log: result.log,
      });
    }

    if (sourceType === 'docker_volume') {
      if (volumeName && !isValidDockerVolumeName(volumeName)) {
        return NextResponse.json(
          { error: 'Invalid Docker volume name' },
          { status: 400 }
        );
      }
      const result = await restoreDockerVolumeBackup(id, {
        volumeName,
        confirm: true,
        allowRetarget,
      });
      return NextResponse.json({
        success: true,
        volumeName: result.volumeName,
        log: result.log,
      });
    }

    if (sourceType === 'path') {
      const result = await restorePathBackup(id, {
        targetPath,
        confirm: true,
        allowRetarget,
      });
      return NextResponse.json({
        success: true,
        targetPath: result.targetPath,
        log: result.log,
      });
    }

    return NextResponse.json(
      {
        error:
          'Restore is only supported for path, Docker volume, and database backups',
      },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof PeerRecallPendingError) {
      return NextResponse.json(peerRecallWaitingResponse(error.recallId), {
        status: 202,
      });
    }
    console.error(`Failed to restore backup ${id}:`, error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to restore backup';
    const status =
      message.includes('not found') ||
      message.includes('Only successful') ||
      message.includes('only supported') ||
      message.includes('only for path')
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
