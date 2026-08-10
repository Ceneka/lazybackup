import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { listDockerVolumes } from '@/lib/docker/volumes';
import { connectToServer } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/servers/[id]/docker/volumes - List Docker volumes on the remote host
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
      const volumes = await listDockerVolumes(ssh);
      return NextResponse.json({ volumes });
    } finally {
      ssh.dispose();
    }
  } catch (error) {
    console.error(`Failed to list Docker volumes for server ${id}:`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to list Docker volumes',
      },
      { status: 400 }
    );
  }
}
