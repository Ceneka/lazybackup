import { restoreDatabaseBackup, restoreDockerVolumeBackup, restoreGitRepoBackup, restorePathBackup } from '@/lib/backup';
import {
  RESTORE_CONFIRM_REQUIRED,
  hasRestoreConfirm,
  restoreHistorySchema,
} from '@/lib/backup/history-schema';
import { httpStatusForRestoreError } from '@/lib/backup/restore-errors';
import { parseRestoreSnapshot } from '@/lib/backup/restore-snapshot';
import { isValidDockerVolumeName } from '@/lib/docker/volumes';
import { DB_NAME_RE, assertValidSqlitePath } from '@/lib/database';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import {
  PeerRecallBlockedError,
  PeerRecallFailedError,
  PeerRecallPendingError,
  peerRecallWaitingResponse,
} from '@/lib/peer/recall';
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
    const { volumeName, databaseName, targetPath, allowRetarget, targetServerId } =
      restoreHistorySchema.parse(body);

    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: { backupConfig: { columns: { sourceType: true, dbEngine: true } } },
    });

    if (!historyEntry) {
      return NextResponse.json({ error: 'Backup history entry not found' }, { status: 404 });
    }

    // Explicit retry after a failed peer recall (digest mismatch, …): forget the
    // failed attempt so the normal restore path can ask the friend again.
    if ((body as { retry?: unknown })?.retry === true && historyEntry.artifactPath) {
      const { parsePeerArtifactPath } = await import('@/lib/peer/retention');
      const { resetFailedRecall } = await import('@/lib/peer/recall');
      const parsed = parsePeerArtifactPath(historyEntry.artifactPath);
      await resetFailedRecall({
        historyId: historyEntry.id,
        peerId: parsed?.peerId,
        objectKey: parsed?.objectKey,
      });
    }

    const snapshot = parseRestoreSnapshot(historyEntry.configSnapshot);
    const sourceType = snapshot?.sourceType || historyEntry.backupConfig?.sourceType || 'path';
    const dbEngine = snapshot?.dbEngine ?? historyEntry.backupConfig?.dbEngine;

    if (sourceType === 'database') {
      if (databaseName && dbEngine === 'sqlite') {
        // SQLite targets are filesystem paths, not SQL identifiers.
        try {
          assertValidSqlitePath(databaseName);
        } catch {
          return NextResponse.json(
            { error: 'Invalid SQLite database path' },
            { status: 400 }
          );
        }
      } else if (databaseName && !DB_NAME_RE.test(databaseName)) {
        return NextResponse.json({ error: 'Invalid database name' }, { status: 400 });
      }
      const result = await restoreDatabaseBackup(id, {
        databaseName,
        confirm: true,
        allowRetarget,
        targetServerId,
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
        targetServerId,
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
        targetServerId,
      });
      return NextResponse.json({
        success: true,
        targetPath: result.targetPath,
        log: result.log,
      });
    }

    if (sourceType === 'git_repo') {
      const result = await restoreGitRepoBackup(id, {
        targetPath,
        confirm: true,
        allowRetarget,
        targetServerId,
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
          'Restore is only supported for path, Docker volume, database, and Git repository backups',
      },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof PeerRecallPendingError) {
      return NextResponse.json(peerRecallWaitingResponse(error.recallId), {
        status: 202,
      });
    }
    if (error instanceof PeerRecallBlockedError || error instanceof PeerRecallFailedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`Failed to restore backup ${id}:`, error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to restore backup';
    return NextResponse.json({ error: message }, { status: httpStatusForRestoreError(error) });
  }
}
