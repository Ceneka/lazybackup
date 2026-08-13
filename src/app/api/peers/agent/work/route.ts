import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { listOpenRecallsForPeer } from '@/lib/peer/recall';
import { listPendingDeletesForWork } from '@/lib/peer/retention';
import { listStagedObjects, stagingUsedBytes } from '@/lib/peer/staging';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/peers/agent/work — staged pulls + open recalls + retention deletes for the calling peer.
 */
export async function GET(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }

  await touchPeerSeen(peer.id);

  const [pulls, recalls, deletes, stagedBytes] = await Promise.all([
    listStagedObjects(peer.id),
    listOpenRecallsForPeer(peer.id),
    listPendingDeletesForWork(peer.id),
    stagingUsedBytes(peer.id),
  ]);

  const deleteKeys = new Set(deletes.map((d) => d.key));
  const advertisedPulls = pulls.filter((p) => !deleteKeys.has(p.key));

  return NextResponse.json({
    peerId: peer.id,
    quotaBytes: peer.quotaBytes,
    usedBytes: peer.usedBytes,
    stagedBytes,
    pulls: advertisedPulls.map((p) => ({ key: p.key, size: p.size, mtime: p.mtime })),
    recalls,
    deletes,
    serverTime: new Date().toISOString(),
  });
}
