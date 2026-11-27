import { clearMailboxPendingForArtifact } from '@/lib/backup/history';
import {
  CappedJsonError,
  PEER_PAIR_JSON_LIMIT,
  readCappedRequestJson,
} from '@/lib/net/capped-json';
import { decideMailboxAck, decideMailboxDeleteAck } from '@/lib/peer/mailbox-ack';
import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { withPeerLock } from '@/lib/peer/peer-lock';
import { listObjectKeysWithOpenRecalls } from '@/lib/peer/recall';
import {
  completePeerDeleteAckUnlocked,
  getPeerDelete,
} from '@/lib/peer/retention';
import { deleteStagedObject, stagedObjectDigest } from '@/lib/peer/staging';
import { assertSafePeerObjectKey } from '@/lib/peer/storage';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ackSchema = z.object({
  key: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  exists: z.boolean().optional(),
});

/**
 * POST /api/peers/agent/ack — Bro confirms a staged pull (sha256) or a retention delete
 * (exists=false / size 0). Host only drops staging / forgets quota after a verified receipt.
 */
export async function POST(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }
  await touchPeerSeen(peer.id);

  try {
    const body = ackSchema.parse(
      await readCappedRequestJson(request, PEER_PAIR_JSON_LIMIT)
    );
    const key = assertSafePeerObjectKey(body.key);

    if (body.exists === false) {
      const decision = decideMailboxDeleteAck({ ...body, key });
      if (decision.action === 'keep') {
        const message =
          decision.reason === 'missing_proof'
            ? 'Delete ACK omitted exists=false; keeping pending delete'
            : 'Delete ACK claims a non-zero size; keeping pending delete';
        console.warn(`[mailbox-delete-ack] peer=${peer.id} key=${key}: ${message}`);
        return NextResponse.json(
          { ok: false, verified: false, key, reason: decision.reason, error: message },
          { status: 409 }
        );
      }

      // Same peer lock as staging: a new run must not overwrite the key
      // between reading this delete and deleting the staged file.
      const outcome = await withPeerLock(peer.id, async () => {
        const row = await getPeerDelete(peer.id, key);
        if (!row) return { kind: 'missing' as const };
        const openRecalls = await listObjectKeysWithOpenRecalls(peer.id);
        if (openRecalls.has(key)) return { kind: 'recall' as const };
        if (row.status !== 'acked') {
          // Lock already held: use the unlocked variant (the lock is not reentrant).
          const acked = await completePeerDeleteAckUnlocked(peer.id, key);
          // A newer run reclaimed this key (cleared the delete) before this ACK:
          // the friend dropped the old copy, but the new generation stays.
          if (!acked) return { kind: 'superseded' as const };
        }
        return { kind: 'ok' as const };
      });

      if (outcome.kind === 'missing') {
        return NextResponse.json({ error: 'Pending delete not found' }, { status: 404 });
      }
      if (outcome.kind === 'recall') {
        return NextResponse.json(
          {
            ok: false,
            verified: false,
            key,
            reason: 'recall_open',
            error: 'Open recall for this key; delete delayed',
          },
          { status: 409 }
        );
      }
      if (outcome.kind === 'superseded') {
        return NextResponse.json({
          ok: true,
          verified: false,
          superseded: true,
          deleted: true,
          key,
        });
      }
      return NextResponse.json({ ok: true, verified: true, deleted: true, key });
    }

    // The peer lock serializes digest → clear → delete with writeStagedObject.
    // Otherwise a late ACK for the previous bytes could pass its digest check,
    // then delete the fresh staging file written in between, and the new run
    // would later look "delivered" to the reconciliation.
    const outcome = await withPeerLock(peer.id, async () => {
      const staged = await stagedObjectDigest(peer.id, key);
      if (!staged) return { kind: 'missing' as const };

      const decision = decideMailboxAck({
        claimed: { ...body, key },
        stagedSize: staged.size,
        stagedSha256: staged.sha256,
      });
      if (decision.action === 'keep') {
        return { kind: 'keep' as const, reason: decision.reason };
      }

      // Clear first: if the DB write fails the staged file must survive so the
      // peer can retry the ACK. The reverse order loses the only retry path
      // (staging gone, pending still true) and the success ping is never sent.
      await clearMailboxPendingForArtifact(`peer://${peer.id}/${key}`);
      await deleteStagedObject(peer.id, key);
      return { kind: 'ok' as const, staged };
    });

    if (outcome.kind === 'missing') {
      return NextResponse.json({ error: 'Staged object not found' }, { status: 404 });
    }
    if (outcome.kind === 'keep') {
      const message =
        outcome.reason === 'missing_receipt'
          ? 'ACK omitted sha256; keeping staging until a verified receipt'
          : 'ACK size/sha256 does not match staged object; keeping staging';
      console.warn(`[mailbox-ack] peer=${peer.id} key=${key}: ${message}`);
      return NextResponse.json(
        { ok: false, verified: false, key, reason: outcome.reason, error: message },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      key,
      size: outcome.staged.size,
      sha256: outcome.staged.sha256,
    });
  } catch (error) {
    if (error instanceof CappedJsonError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
