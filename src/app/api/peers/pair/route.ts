import { completePairFromAcceptor } from '@/lib/peer/pairing';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const pairSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
  acceptor: z.object({
    peerId: z.string().min(1),
    baseUrl: z.string().url(),
    label: z.string().min(1).max(80),
    inboundToken: z.string().min(20),
    quotaBytes: z.number().int().positive(),
  }),
});

/**
 * POST /api/peers/pair — called by the accepting bro's instance (no session).
 * Authenticated by invite code + secret.
 */
export async function POST(request: NextRequest) {
  try {
    const body = pairSchema.parse(await request.json());
    const result = await completePairFromAcceptor(body);
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
      { error: error instanceof Error ? error.message : 'Pairing failed' },
      { status: 400 }
    );
  }
}
