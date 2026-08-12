import { clearMailboxPendingForArtifact } from '@/lib/backup/history';
import { decideMailboxAck } from '@/lib/peer/mailbox-ack';
import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { deleteStagedObject, stagedObjectDigest } from '@/lib/peer/staging';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ackSchema = z.object({
  key: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
});

/**
 * POST /api/peers/agent/ack — Bro confirms it stored a staged object.
 * Staging is dropped only when size/sha256 match the staged ciphertext.
 */
export async function POST(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  try {
    const body = ackSchema.parse(await request.json());
    const staged = await stagedObjectDigest(peer.id, body.key);
    if (!staged) {
      return NextResponse.json({ error: 'Staged object not found' }, { status: 404 });
    }

    const decision = decideMailboxAck({
      claimed: body,
      stagedSize: staged.size,
      stagedSha256: staged.sha256,
    });

    if (decision.action === 'keep') {
      const message =
        decision.reason === 'missing_receipt'
          ? 'ACK omitted sha256; keeping staging until a verified receipt'
          : 'ACK size/sha256 does not match staged object; keeping staging';
      console.warn(`[mailbox-ack] peer=${peer.id} key=${body.key}: ${message}`);
      return NextResponse.json(
        { ok: false, verified: false, key: body.key, reason: decision.reason, error: message },
        { status: 409 }
      );
    }

    await deleteStagedObject(peer.id, body.key);
    await clearMailboxPendingForArtifact(`peer://${peer.id}/${body.key}`);
    return NextResponse.json({
      ok: true,
      verified: true,
      key: body.key,
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
