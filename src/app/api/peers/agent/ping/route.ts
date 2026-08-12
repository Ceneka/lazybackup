import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/peers/agent/ping — soft presence + clock.
 */
export async function GET(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }

  await touchPeerSeen(peer.id);

  return NextResponse.json({
    ok: true,
    peerId: peer.id,
    serverTime: new Date().toISOString(),
  });
}
