import {
  CappedJsonError,
  PEER_STATUS_JSON_LIMIT,
  readCappedRequestJson,
} from '@/lib/net/capped-json';
import { touchPeerSeen, verifyPeerBearer } from '@/lib/peer/pairing';
import { recordPeerReport, REMOTE_LAST_ERROR_MAX } from '@/lib/peer/reports';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * GET /api/peers/agent/ping — soft presence + clock.
 * POST /api/peers/agent/ping — same auth + a small status report (C3):
 * `{usedBytes, quotaBytes, pendingPulls, pendingRecalls, lastSyncAt, lastError, appVersion}`.
 * Old clients that only GET keep working.
 */

const MAX_BYTES = 1_000_000_000_000_000; // 1 PB, far above any real quota
const MAX_PENDING = 1_000_000;

const reportSchema = z.object({
  usedBytes: z.number().int().nonnegative().max(MAX_BYTES).optional(),
  quotaBytes: z.number().int().nonnegative().max(MAX_BYTES).optional(),
  pendingPulls: z.number().int().nonnegative().max(MAX_PENDING).optional(),
  pendingRecalls: z.number().int().nonnegative().max(MAX_PENDING).optional(),
  lastSyncAt: z
    .string()
    .max(64)
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO timestamp')
    .optional()
    .nullable(),
  // Truncate rather than reject: a long log line must not break reporting.
  lastError: z
    .string()
    .max(4000)
    .optional()
    .nullable()
    .transform((value) => value?.slice(0, REMOTE_LAST_ERROR_MAX) ?? null),
  appVersion: z
    .string()
    .max(64)
    .optional()
    .nullable()
    .transform((value) => value?.slice(0, 64) ?? null),
});

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

export async function POST(request: NextRequest) {
  const peer = await verifyPeerBearer(request.headers.get('authorization'));
  if (!peer) {
    return NextResponse.json({ error: 'Unauthorized peer' }, { status: 401 });
  }

  try {
    const parsed = reportSchema.parse(
      await readCappedRequestJson(request, PEER_STATUS_JSON_LIMIT)
    );
    await recordPeerReport(peer.id, {
      usedBytes: parsed.usedBytes,
      quotaBytes: parsed.quotaBytes,
      pendingPulls: parsed.pendingPulls,
      pendingRecalls: parsed.pendingRecalls,
      lastSyncAt: parsed.lastSyncAt ? new Date(parsed.lastSyncAt) : undefined,
      lastError: parsed.lastError,
      appVersion: parsed.appVersion,
    });
    return NextResponse.json({
      ok: true,
      peerId: peer.id,
      serverTime: new Date().toISOString(),
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
      { error: error instanceof Error ? error.message : 'Ping failed' },
      { status: 400 }
    );
  }
}
