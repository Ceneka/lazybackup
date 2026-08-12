import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import {
  completeRecallUpload,
  getRecall,
  markRecallUploading,
} from '@/lib/peer/recall';
import { NextRequest, NextResponse } from 'next/server';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/peers/agent/recall/[id] — Bro uploads ciphertext for an open recall.
 */
export async function PUT(request: NextRequest, context: Ctx) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  const { id } = await context.params;
  const row = await getRecall(id);
  if (!row || row.peerId !== peer.id) {
    return NextResponse.json({ error: 'Recall not found' }, { status: 404 });
  }

  try {
    await markRecallUploading(id);
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 });
    }
    await completeRecallUpload(id, peer.id, buf);
    return NextResponse.json({ ok: true, recallId: id, size: buf.byteLength });
  } catch (error) {
    console.error('Recall upload failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recall upload failed' },
      { status: 400 }
    );
  }
}
