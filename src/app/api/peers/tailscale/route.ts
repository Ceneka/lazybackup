import { isSessionAuthorized } from '@/lib/auth';
import { getInstanceBaseUrl, setInstanceBaseUrl } from '@/lib/peer/pairing';
import {
  getTailscaleStatus,
  joinTailscaleWithAuthKey,
} from '@/lib/peer/tailscale';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage Tailscale helpers' },
      { status: 401 }
    );
  }
  return null;
}

/** GET /api/peers/tailscale — detect Tailscale without bundling it */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const [status, instanceBaseUrl] = await Promise.all([
      getTailscaleStatus(),
      getInstanceBaseUrl(),
    ]);
    return NextResponse.json({ ...status, instanceBaseUrl });
  } catch (error) {
    console.error('Tailscale status failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read Tailscale' },
      { status: 500 }
    );
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('useSuggestedUrl'),
  }),
  z.object({
    action: z.literal('join'),
    authKey: z.string().min(10),
    /** Also save suggested URL as instance base URL when connected */
    setInstanceUrl: z.boolean().optional().default(true),
  }),
]);

export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const body = postSchema.parse(await request.json());

    if (body.action === 'useSuggestedUrl') {
      const status = await getTailscaleStatus();
      if (!status.suggestedBaseUrl) {
        return NextResponse.json(
          { error: 'No Tailscale IP/DNS yet. Connect Tailscale first.' },
          { status: 400 }
        );
      }
      await setInstanceBaseUrl(status.suggestedBaseUrl);
      return NextResponse.json({
        instanceBaseUrl: status.suggestedBaseUrl,
        status,
      });
    }

    const result = await joinTailscaleWithAuthKey(body.authKey);
    if (body.setInstanceUrl && result.status.suggestedBaseUrl) {
      await setInstanceBaseUrl(result.status.suggestedBaseUrl);
    }
    return NextResponse.json({
      ...result,
      instanceBaseUrl:
        body.setInstanceUrl && result.status.suggestedBaseUrl
          ? result.status.suggestedBaseUrl
          : await getInstanceBaseUrl(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Tailscale action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tailscale action failed' },
      { status: 400 }
    );
  }
}
