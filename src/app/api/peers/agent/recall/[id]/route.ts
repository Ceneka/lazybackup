import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import {
  getRecall,
  ingestRecallChunk,
  ingestRecallUpload,
  markRecallUploading,
} from '@/lib/peer/recall';
import { PEER_RECALL_CHUNK_MAX_BYTES } from '@/lib/peer/recall-chunk';
import { publicUploadErrorMessage } from '@/lib/peer/upload-errors';
import { assertDeclaredUploadSize } from '@/lib/peer/upload-limit';
import { NextRequest, NextResponse } from 'next/server';

type Ctx = { params: Promise<{ id: string }> };

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * PUT /api/peers/agent/recall/[id] — Bro uploads ciphertext for an open recall.
 * Large artifacts are sent in chunks (?chunk=N&chunks=M&total=bytes) so reverse
 * proxies never see the whole body; a plain body is still accepted (legacy).
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
    const chunkParam = request.nextUrl.searchParams.get('chunk');
    if (chunkParam != null) {
      const chunkIndex = parseNonNegativeInt(chunkParam);
      const chunkCount = parseNonNegativeInt(request.nextUrl.searchParams.get('chunks'));
      const totalBytes = parseNonNegativeInt(request.nextUrl.searchParams.get('total'));
      if (chunkIndex == null || chunkCount == null || totalBytes == null) {
        return NextResponse.json(
          { error: 'Invalid recall chunk parameters' },
          { status: 400 }
        );
      }
      // A chunk is at most PEER_RECALL_CHUNK_MAX_BYTES; the quota is enforced
      // against the whole artifact inside ingestRecallChunk (small quotas must
      // not reject a fixed-size chunk before the total is known).
      const declaredBytes = assertDeclaredUploadSize({
        contentLengthHeader: request.headers.get('content-length'),
        quotaBytes: Math.max(peer.quotaBytes, PEER_RECALL_CHUNK_MAX_BYTES),
        hardCapBytes: PEER_RECALL_CHUNK_MAX_BYTES,
      });
      await markRecallUploading(id);
      const result = await ingestRecallChunk({
        recallId: id,
        peerId: peer.id,
        quotaBytes: peer.quotaBytes,
        chunkIndex,
        chunkCount,
        totalBytes,
        declaredBytes,
        body: request.body,
      });
      return NextResponse.json({ ok: true, recallId: id, ...result });
    }

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
    const { status, message } = publicUploadErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
}
