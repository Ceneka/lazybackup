import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { listDockerContainers } from '@/lib/docker/containers';
import { connectToServer } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/servers/[id]/docker/containers — list running container names
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

    const ssh = await connectToServer(server);
    try {
      const containers = await listDockerContainers(ssh);
      return NextResponse.json({ containers });
    } finally {
      ssh.dispose();
    }
  } catch (error) {
    console.error(`Failed to list Docker containers for server ${id}:`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to list Docker containers',
      },
      { status: 400 }
    );
  }
}
