import { isBearerAudience, redactDbHints } from '@/lib/api/redact';
import { resolveAuth } from '@/lib/auth';
import { inspectLocalContainerDatabaseHints } from '@/lib/docker/containers';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/docker/containers/[name]/db-hints — infer DB creds from local docker inspect
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const containerName = decodeURIComponent(name);

  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const auth = await resolveAuth(
      request.headers.get('cookie'),
      request.headers.get('authorization')
    );
    const includePassword = !isBearerAudience(auth.via);

    const hints = await inspectLocalContainerDatabaseHints(containerName);
    return NextResponse.json({
      hints: redactDbHints(hints as unknown as Record<string, unknown>, {
        includePassword,
      }),
    });
  } catch (error) {
    console.error(
      `Failed to inspect DB hints for local container ${containerName}:`,
      error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to inspect container',
      },
      { status: 400 }
    );
  }
}
