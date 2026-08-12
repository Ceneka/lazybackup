import { isSessionAuthorized } from '@/lib/auth';
import {
  consumeRecallArtifact,
  ensureRecall,
  waitForRecall,
} from '@/lib/peer/recall';
import { stagedObjectExists } from '@/lib/peer/staging';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({
  peerId: z.string().min(1),
  objectKey: z.string().min(1),
  historyId: z.string().optional(),
  /** Max ms to wait for Bro (default 15min). Soft 202 if still pending. */
  waitMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
});

/**
 * POST /api/peers/recall — session: create recall and wait for Bro (soft timeout).
 */
export async function POST(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = bodySchema.parse(await request.json());
    const peer = await db.query.peers.findFirst({ where: eq(peers.id, body.peerId) });
    if (!peer || peer.status !== 'active') {
      return NextResponse.json({ error: 'Peer not found' }, { status: 404 });
    }

    // Still in staging — no recall needed
    if (await stagedObjectExists(peer.id, body.objectKey)) {
      return NextResponse.json({
        status: 'staged',
        message: 'Object is still in local staging; no recall needed',
        peerId: peer.id,
        objectKey: body.objectKey,
      });
    }

    const recall = await ensureRecall({
      peerId: peer.id,
      objectKey: body.objectKey,
      historyId: body.historyId,
    });

    if (recall.status === 'ready') {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-'));
      const localPath = path.join(tempDir, path.basename(body.objectKey));
      await consumeRecallArtifact(recall.id, peer.id, localPath);
      return NextResponse.json({
        status: 'ready',
        recallId: recall.id,
        localPath,
        tempDir,
      });
    }

    const waited = await waitForRecall(recall.id, body.waitMs);
    if (waited.status === 'ready') {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-recall-'));
      const localPath = path.join(tempDir, path.basename(body.objectKey));
      await consumeRecallArtifact(recall.id, peer.id, localPath);
      return NextResponse.json({
        status: 'ready',
        recallId: recall.id,
        localPath,
        tempDir,
      });
    }

    // Soft — not a failure / not webhook-worthy
    return NextResponse.json(
      {
        status: 'waiting',
        recallId: recall.id,
        message:
          waited.status === 'waiting'
            ? waited.message
            : 'Recall expired or failed; create a new restore when Bro is online',
        peerId: peer.id,
        objectKey: body.objectKey,
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Recall request failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recall failed' },
      { status: 500 }
    );
  }
}
