import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { listOpenRecallsForPeer } from '@/lib/peer/recall';
import { listStagedObjects, stagingUsedBytes } from '@/lib/peer/staging';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/peers/agent/work — staged pulls + open recalls for the calling peer.
 */
export async function GET(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }

  await touchPeerSeen(peer.id);

  const [pulls, recalls, stagedBytes] = await Promise.all([
    listStagedObjects(peer.id),
    listOpenRecallsForPeer(peer.id),
    stagingUsedBytes(peer.id),
  ]);

  return NextResponse.json({
    peerId: peer.id,
    quotaBytes: peer.quotaBytes,
    usedBytes: peer.usedBytes,
    stagedBytes,
    pulls: pulls.map((p) => ({ key: p.key, size: p.size, mtime: p.mtime })),
    recalls,
    serverTime: new Date().toISOString(),
  });
}
