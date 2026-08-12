import { verifyPeerBearer } from '@/lib/peer/pairing';
import {
  deletePeerObjectFile,
  ingestPeerObjectUpload,
  listPeerObjects,
  readPeerObject,
} from '@/lib/peer/storage';
import {
  assertDeclaredUploadSize,
  PeerUploadLimitError,
} from '@/lib/peer/upload-limit';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Peer opaque object store.
 * Auth: Bearer lbpeer_… (inbound token for this peer).
 *
 * GET    /api/peers/store              — list objects (metadata)
 * PUT    /api/peers/store?key=…        — upload body
 * GET    /api/peers/store?key=…        — download
 * DELETE /api/peers/store?key=…        — delete
 */

async function requirePeer(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return { error: NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 }) };
  }
  return { peer };
}

export async function GET(request: NextRequest) {
  const auth = await requirePeer(request);
  if ('error' in auth && auth.error) return auth.error;
  const peer = auth.peer!;

  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    const objects = await listPeerObjects(peer.id);
    return NextResponse.json({
      peerId: peer.id,
      quotaBytes: peer.quotaBytes,
      usedBytes: peer.usedBytes,
      objects,
    });
  }

  try {
    const data = await readPeerObject(peer.id, key);
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Object not found' }, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requirePeer(request);
  if ('error' in auth && auth.error) return auth.error;
  const peer = auth.peer!;

  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'key query parameter is required' }, { status: 400 });
  }

  try {
    const declaredBytes = assertDeclaredUploadSize({
      contentLengthHeader: request.headers.get('content-length'),
      quotaBytes: peer.quotaBytes,
    });
    const result = await ingestPeerObjectUpload({
      peerId: peer.id,
      objectKey: key,
      quotaBytes: peer.quotaBytes,
      declaredBytes,
      body: request.body,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Peer store PUT failed:', error);
    const status = error instanceof PeerUploadLimitError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePeer(request);
  if ('error' in auth && auth.error) return auth.error;
  const peer = auth.peer!;

  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'key query parameter is required' }, { status: 400 });
  }

  const result = await deletePeerObjectFile(peer.id, key);
  return NextResponse.json(result);
}
