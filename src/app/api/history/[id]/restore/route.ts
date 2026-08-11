import { restoreDatabaseBackup, restoreDockerVolumeBackup } from '@/lib/backup';
import { isValidDockerVolumeName } from '@/lib/docker/volumes';
import { DB_NAME_RE } from '@/lib/database';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const restoreSchema = z.object({
  volumeName: z.string().min(1).optional(),
  databaseName: z.string().min(1).optional(),
});

// POST /api/history/[id]/restore — restore Docker volume or database dump
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
    const { volumeName, databaseName } = restoreSchema.parse(body);

    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: { backupConfig: true },
    });

    if (!historyEntry) {
      return NextResponse.json({ error: 'Backup history entry not found' }, { status: 404 });
    }

    const sourceType = historyEntry.backupConfig?.sourceType || 'path';

    if (sourceType === 'database') {
      if (databaseName && !DB_NAME_RE.test(databaseName)) {
        return NextResponse.json({ error: 'Invalid database name' }, { status: 400 });
      }
      const result = await restoreDatabaseBackup(id, databaseName);
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
      const result = await restoreDockerVolumeBackup(id, volumeName);
      return NextResponse.json({
        success: true,
        volumeName: result.volumeName,
        log: result.log,
      });
    }

    return NextResponse.json(
      { error: 'Restore is only supported for Docker volume and database backups' },
      { status: 400 }
    );
  } catch (error) {
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
      message.includes('only supported')
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
