import { isSessionAuthorized } from '@/lib/auth';
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  getInstanceBaseUrl,
  listInvites,
  listPeers,
  revokePeer,
  setInstanceBaseUrl,
} from '@/lib/peer/pairing';
import { bytesToGb } from '@/lib/peer/types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage Bro Space' },
      { status: 401 }
    );
  }
  return null;
}

/** GET /api/peers — list peers + invites + instance URL */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const [peerList, invites, instanceBaseUrl] = await Promise.all([
      listPeers(),
      listInvites(),
      getInstanceBaseUrl(),
    ]);
    return NextResponse.json({
      instanceBaseUrl,
      peers: peerList.map((p) => ({
        ...p,
        quotaGb: Math.round(bytesToGb(p.quotaBytes) * 100) / 100,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        code: i.code,
        label: i.label,
        quotaBytes: i.quotaBytes,
        quotaGb: Math.round(bytesToGb(i.quotaBytes) * 100) / 100,
        status: i.status,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
        localBaseUrl: i.localBaseUrl,
      })),
    });
  } catch (error) {
    console.error('Failed to list peers:', error);
    return NextResponse.json({ error: 'Failed to list peers' }, { status: 500 });
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setBaseUrl'),
    baseUrl: z.string().min(1),
  }),
  z.object({
    action: z.literal('createInvite'),
    label: z.string().min(1).max(80).default('LazyBackup'),
    quotaGb: z.coerce.number().min(1).max(100000),
  }),
  z.object({
    action: z.literal('acceptInvite'),
    inviteCode: z.string().min(10),
    label: z.string().min(1).max(80).default('LazyBackup'),
  }),
  z.object({
    action: z.literal('cancelInvite'),
    inviteId: z.string().min(1),
  }),
  z.object({
    action: z.literal('revokePeer'),
    peerId: z.string().min(1),
  }),
]);

export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const body = postSchema.parse(await request.json());

    if (body.action === 'setBaseUrl') {
      await setInstanceBaseUrl(body.baseUrl);
      return NextResponse.json({ instanceBaseUrl: body.baseUrl.replace(/\/+$/, '') });
    }

    if (body.action === 'createInvite') {
      const created = await createInvite({
        label: body.label,
        quotaGb: body.quotaGb,
      });
      return NextResponse.json(
        {
          inviteCode: created.inviteCode,
          expiresAt: created.expiresAt,
          quotaGb: body.quotaGb,
        },
        { status: 201 }
      );
    }

    if (body.action === 'acceptInvite') {
      const peer = await acceptInvite({
        inviteCode: body.inviteCode,
        localLabel: body.label,
      });
      return NextResponse.json(peer, { status: 201 });
    }

    if (body.action === 'cancelInvite') {
      await cancelInvite(body.inviteId);
      return NextResponse.json({ success: true });
    }

    await revokePeer(body.peerId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Peer action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Peer action failed' },
      { status: 400 }
    );
  }
}
