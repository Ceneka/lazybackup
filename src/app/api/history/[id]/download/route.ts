import { loadRestoreEndpointRows, resolveLocalRestoreArtifact } from '@/lib/backup';
import {
  canDownloadBackup,
  contentDispositionAttachment,
  downloadFilenameForLocalPath,
  restoreBlockedReason,
} from '@/lib/backup/restore-eligibility';
import { httpStatusForRestoreError } from '@/lib/backup/restore-errors';
import {
  effectiveRestoreConfig,
  parseRestoreSnapshot,
} from '@/lib/backup/restore-snapshot';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import {
  PeerRecallBlockedError,
  PeerRecallFailedError,
  PeerRecallPendingError,
  peerRecallWaitingResponse,
} from '@/lib/peer/recall';
import { execFile } from 'child_process';
import { eq } from 'drizzle-orm';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function packDirectoryTarGz(dirPath: string): Promise<{
  filePath: string;
  tempDir: string;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-download-'));
  const base = path.basename(dirPath) || 'backup';
  const filePath = path.join(tempDir, `${base}.tar.gz`);
  await execFileAsync('tar', ['-czf', filePath, '-C', path.dirname(dirPath), base], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { filePath, tempDir };
}

function streamFile(
  filePath: string,
  headers: HeadersInit,
  onClose: () => void
): NextResponse {
  const nodeStream = createReadStream(filePath);
  nodeStream.on('close', onClose);
  nodeStream.on('error', onClose);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, { headers });
}

// GET /api/history/[id]/download — stream the restore artifact (session)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cleanupPaths: string[] = [];
  const cleanup = async () => {
    for (const dir of cleanupPaths) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };

  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: {
        backupConfig: {
          with: {
            server: true,
            sourceS3Profile: true,
            destinationS3Profile: true,
            destinationPeer: true,
            destinationServer: true,
          },
        },
      },
    });

    if (!historyEntry) {
      return NextResponse.json(
        { error: 'Backup history entry not found' },
        { status: 404 }
      );
    }

    if (request.nextUrl.searchParams.get('retry') === '1' && historyEntry.artifactPath) {
      // Retrying forgets a failed recall (deletes rows + spool data). A GET is
      // fine for a download, but read_only API tokens must not mutate state.
      const { authAllowsWrite, resolveAuth } = await import('@/lib/auth');
      const auth = await resolveAuth(
        request.headers.get('cookie'),
        request.headers.get('authorization')
      );
      if (!authAllowsWrite(auth)) {
        return NextResponse.json(
          { error: 'API token is read_only' },
          { status: 403 }
        );
      }
      const { parsePeerArtifactPath } = await import('@/lib/peer/retention');
      const { resetFailedRecall } = await import('@/lib/peer/recall');
      const parsed = parsePeerArtifactPath(historyEntry.artifactPath);
      await resetFailedRecall({
        historyId: historyEntry.id,
        peerId: parsed?.peerId,
        objectKey: parsed?.objectKey,
      });
    }

    const config = historyEntry.backupConfig;
    if (!config) {
      return NextResponse.json(
        { error: 'Backup configuration not found for this history entry' },
        { status: 404 }
      );
    }

    // Use the run snapshot, exactly like restore: the live config may point at
    // a different destination now, which made downloads of old artifacts try
    // the wrong backend (or refuse a perfectly good local file).
    const effective = effectiveRestoreConfig(
      parseRestoreSnapshot(historyEntry.configSnapshot),
      config
    );
    const endpoints = await loadRestoreEndpointRows(config, effective);
    const eligibility = {
      status: historyEntry.status,
      sourceType: effective.sourceType,
      destinationKind: effective.destinationKind,
      artifactPath: historyEntry.artifactPath,
      artifactRemoved: historyEntry.artifactRemoved,
      destinationAuthType: endpoints.destinationServer?.authType,
    };

    if (!canDownloadBackup(eligibility)) {
      return NextResponse.json(
        {
          error:
            restoreBlockedReason(eligibility) ||
            'This artifact cannot be downloaded',
        },
        { status: 400 }
      );
    }

    if (!historyEntry.artifactPath) {
      return NextResponse.json(
        { error: 'This run has no stored artifact path.' },
        { status: 400 }
      );
    }

    const resolved = await resolveLocalRestoreArtifact({
      artifactPath: historyEntry.artifactPath,
      destinationKind: effective.destinationKind,
      destinationS3Profile: endpoints.destinationS3Profile,
      destinationPeer: endpoints.destinationPeer,
      destinationServer: endpoints.destinationServer,
      expectedSha256: historyEntry.artifactSha256,
      historyId: historyEntry.id,
      decrypt: false,
    });
    if (resolved.tempDir) cleanupPaths.push(resolved.tempDir);

    let filePath = resolved.localPath;
    const st = await fs.stat(filePath);
    if (st.isDirectory()) {
      const packed = await packDirectoryTarGz(filePath);
      cleanupPaths.push(packed.tempDir);
      filePath = packed.filePath;
    }

    const filename = downloadFilenameForLocalPath(filePath, false);
    const fileStat = await fs.stat(filePath);
    const headers: HeadersInit = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDispositionAttachment(filename),
      'Content-Length': String(fileStat.size),
    };

    return streamFile(filePath, headers, () => {
      void cleanup();
    });
  } catch (error) {
    await cleanup();
    if (error instanceof PeerRecallPendingError) {
      return NextResponse.json(peerRecallWaitingResponse(error.recallId), {
        status: 202,
      });
    }
    if (error instanceof PeerRecallBlockedError || error instanceof PeerRecallFailedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`Failed to download backup ${id}:`, error);
    const message =
      error instanceof Error ? error.message : 'Failed to download artifact';
    return NextResponse.json(
      { error: message },
      { status: httpStatusForRestoreError(error) }
    );
  }
}
