import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { readStagedObject } from '@/lib/peer/staging';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/peers/agent/pending?key= — download staged body for the calling peer.
 */
export async function GET(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  const key = request.nextUrl.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'key query parameter is required' }, { status: 400 });
  }

  try {
    const data = await readStagedObject(peer.id, key);
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Object not found in staging' }, { status: 404 });
  }
}
