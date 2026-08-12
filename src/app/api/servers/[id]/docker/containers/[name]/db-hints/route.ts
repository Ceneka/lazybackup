import { isBearerAudience, redactDbHints } from '@/lib/api/redact';
import { resolveAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { inspectContainerDatabaseHints } from '@/lib/docker/containers';
import { connectToServer } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/servers/[id]/docker/containers/[name]/db-hints — infer DB creds from inspect
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params;
  const containerName = decodeURIComponent(name);

  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const server = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    const auth = await resolveAuth(
      request.headers.get('cookie'),
      request.headers.get('authorization')
    );
    const includePassword = !isBearerAudience(auth.via);

    const ssh = await connectToServer(server);
    try {
      const hints = await inspectContainerDatabaseHints(ssh, containerName);
      return NextResponse.json({
        hints: redactDbHints(hints as unknown as Record<string, unknown>, {
          includePassword,
        }),
      });
    } finally {
      ssh.dispose();
    }
  } catch (error) {
    console.error(
      `Failed to inspect DB hints for container ${containerName} on server ${id}:`,
      error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to inspect container',
      },
      { status: 400 }
    );
  }
}
