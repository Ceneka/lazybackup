import { completePairFromAcceptor, PAIRING_FAILED_MESSAGE } from '@/lib/peer/pairing';
import { consumeIpRateLimit } from '@/lib/net/ip-throttle';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const pairSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
  acceptor: z.object({
    peerId: z.string().min(1),
    /** Required for mode=host; omit for LazyBro client */
    baseUrl: z.union([z.string().url(), z.literal('')]).optional(),
    mode: z.enum(['client', 'host']).optional().default('host'),
    label: z.string().min(1).max(80),
    inboundToken: z.string().min(20),
    quotaBytes: z.number().int().positive(),
  }),
});

function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * POST /api/peers/pair — called by accepting bro / LazyBro (no session).
 * Authenticated by invite code + secret.
 */
export async function POST(request: NextRequest) {
  if (!consumeIpRateLimit(`pair:${requestIp(request)}`)) {
    return NextResponse.json({ error: PAIRING_FAILED_MESSAGE }, { status: 429 });
  }

  try {
    const body = pairSchema.parse(await request.json());
    const result = await completePairFromAcceptor({
      code: body.code,
      secret: body.secret,
      acceptor: {
        peerId: body.acceptor.peerId,
        baseUrl: body.acceptor.baseUrl || '',
        mode: body.acceptor.mode,
        label: body.acceptor.label,
        inboundToken: body.acceptor.inboundToken,
        quotaBytes: body.acceptor.quotaBytes,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Peer pair failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : PAIRING_FAILED_MESSAGE },
      { status: 400 }
    );
  }
}
