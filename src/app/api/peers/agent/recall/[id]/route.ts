import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { getRecall, ingestRecallUpload, markRecallUploading } from '@/lib/peer/recall';
import {
  assertDeclaredUploadSize,
  PeerUploadLimitError,
} from '@/lib/peer/upload-limit';
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
    const declaredBytes = assertDeclaredUploadSize({
      contentLengthHeader: request.headers.get('content-length'),
      quotaBytes: peer.quotaBytes,
    });
    await markRecallUploading(id);
    const result = await ingestRecallUpload({
      recallId: id,
      peerId: peer.id,
      quotaBytes: peer.quotaBytes,
      declaredBytes,
      body: request.body,
    });
    return NextResponse.json({ ok: true, recallId: id, size: result.size, sha256: result.sha256 });
  } catch (error) {
    console.error('Recall upload failed:', error);
    const status = error instanceof PeerUploadLimitError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recall upload failed' },
      { status }
    );
  }
}
