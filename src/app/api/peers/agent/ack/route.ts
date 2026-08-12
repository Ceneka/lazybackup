import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { deleteStagedObject } from '@/lib/peer/staging';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ackSchema = z.object({
  key: z.string().min(1),
});

/**
 * POST /api/peers/agent/ack — Bro confirms it stored a staged object; we drop staging.
 */
export async function POST(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  try {
    const body = ackSchema.parse(await request.json());
    await deleteStagedObject(peer.id, body.key);
    return NextResponse.json({ ok: true, key: body.key });
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
