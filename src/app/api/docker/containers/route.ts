import { listLocalDockerContainers } from '@/lib/docker/containers';
import { DockerUnavailableError } from '@/lib/docker/volumes';
import { NextResponse } from 'next/server';

// GET /api/docker/containers — running containers on this host
export async function GET() {
  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const containers = await listLocalDockerContainers();
    return NextResponse.json({ containers });
  } catch (error) {
    console.error('Failed to list local Docker containers:', error);
    if (error instanceof DockerUnavailableError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }
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
