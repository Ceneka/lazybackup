import { clearMailboxPendingForArtifact } from '@/lib/backup/history';
import { decideMailboxAck, decideMailboxDeleteAck } from '@/lib/peer/mailbox-ack';
import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { listObjectKeysWithOpenRecalls } from '@/lib/peer/recall';
import {
  completePeerDeleteAck,
  getPeerDelete,
} from '@/lib/peer/retention';
import { deleteStagedObject, stagedObjectDigest } from '@/lib/peer/staging';
import { assertSafePeerObjectKey } from '@/lib/peer/storage';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ackSchema = z.object({
  key: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  exists: z.boolean().optional(),
});

/**
 * POST /api/peers/agent/ack — Bro confirms a staged pull (sha256) or a retention delete
 * (exists=false / size 0). Host only drops staging / forgets quota after a verified receipt.
 */
export async function POST(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  try {
    const body = ackSchema.parse(await request.json());
    const key = assertSafePeerObjectKey(body.key);

    if (body.exists === false) {
      const decision = decideMailboxDeleteAck({ ...body, key });
      if (decision.action === 'keep') {
        const message =
          decision.reason === 'missing_proof'
            ? 'Delete ACK omitted exists=false; keeping pending delete'
            : 'Delete ACK claims a non-zero size; keeping pending delete';
        console.warn(`[mailbox-delete-ack] peer=${peer.id} key=${key}: ${message}`);
        return NextResponse.json(
          { ok: false, verified: false, key, reason: decision.reason, error: message },
          { status: 409 }
        );
      }

      const row = await getPeerDelete(peer.id, key);
      if (!row) {
        return NextResponse.json({ error: 'Pending delete not found' }, { status: 404 });
      }

      const openRecalls = await listObjectKeysWithOpenRecalls(peer.id);
      if (openRecalls.has(key)) {
        return NextResponse.json(
          {
            ok: false,
            verified: false,
            key,
            reason: 'recall_open',
            error: 'Open recall for this key; delete delayed',
          },
          { status: 409 }
        );
      }

      if (row.status !== 'acked') {
        await completePeerDeleteAck(peer.id, key);
      }
      return NextResponse.json({ ok: true, verified: true, deleted: true, key });
    }

    const staged = await stagedObjectDigest(peer.id, key);
    if (!staged) {
      return NextResponse.json({ error: 'Staged object not found' }, { status: 404 });
    }

    const decision = decideMailboxAck({
      claimed: { ...body, key },
      stagedSize: staged.size,
      stagedSha256: staged.sha256,
    });

    if (decision.action === 'keep') {
      const message =
        decision.reason === 'missing_receipt'
          ? 'ACK omitted sha256; keeping staging until a verified receipt'
          : 'ACK size/sha256 does not match staged object; keeping staging';
      console.warn(`[mailbox-ack] peer=${peer.id} key=${key}: ${message}`);
      return NextResponse.json(
        { ok: false, verified: false, key, reason: decision.reason, error: message },
        { status: 409 }
      );
    }

    await deleteStagedObject(peer.id, key);
    await clearMailboxPendingForArtifact(`peer://${peer.id}/${key}`);
    return NextResponse.json({
      ok: true,
      verified: true,
      key,
      size: staged.size,
      sha256: staged.sha256,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ack failed' },
      { status: 400 }
    );
  }
}
