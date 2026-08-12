import { verifyPeerBearer } from '@/lib/peer/pairing';
import {
  deletePeerObjectFile,
  listPeerObjects,
  readPeerObject,
  writePeerObject,
} from '@/lib/peer/storage';
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
    const buf = Buffer.from(await request.arrayBuffer());
    const result = await writePeerObject(peer.id, key, buf, peer.quotaBytes);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Peer store PUT failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 }
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
