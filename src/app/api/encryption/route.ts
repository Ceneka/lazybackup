import { isSessionAuthorized } from '@/lib/auth';
import {
  clearEncryptionKeys,
  createEncryptionKeys,
  getEncryptionKeyStatus,
  importEncryptionIdentity,
} from '@/lib/crypto/keys';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage encryption keys' },
      { status: 401 }
    );
  }
  return null;
}

/** GET /api/encryption — public recipient status (never returns private key) */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const status = await getEncryptionKeyStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to load encryption status:', error);
    return NextResponse.json({ error: 'Failed to load encryption status' }, { status: 500 });
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate') }),
  z.object({
    action: z.literal('import'),
    identity: z.string().min(20, 'Identity is required'),
  }),
  z.object({
    action: z.literal('reveal'),
  }),
  z.object({ action: z.literal('clear') }),
]);

/**
 * POST /api/encryption
 * - generate: create new keypair (returns identity once)
 * - import: import AGE-SECRET-KEY-…
 * - reveal: return private identity once (operator export)
 * - clear: delete keys
 */
export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const body = postSchema.parse(await request.json());

    if (body.action === 'generate') {
      const pair = await createEncryptionKeys();
      return NextResponse.json(
        {
          configured: true,
          recipient: pair.recipient,
          identity: pair.identity,
        },
        { status: 201 }
      );
    }

    if (body.action === 'import') {
      const pair = await importEncryptionIdentity(body.identity);
      return NextResponse.json({
        configured: true,
        recipient: pair.recipient,
        identity: pair.identity,
      });
    }

    if (body.action === 'reveal') {
      const { getAgeIdentity, getEncryptionKeyStatus } = await import('@/lib/crypto/keys');
      const status = await getEncryptionKeyStatus();
      if (!status.configured) {
        return NextResponse.json({ error: 'No encryption key configured' }, { status: 404 });
      }
      const identity = await getAgeIdentity();
      return NextResponse.json({
        configured: true,
        recipient: status.recipient,
        identity,
      });
    }

    await clearEncryptionKeys();
    return NextResponse.json({ configured: false, recipient: null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Encryption key action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update encryption keys' },
      { status: 400 }
    );
  }
}
