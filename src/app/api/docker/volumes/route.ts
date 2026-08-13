import { listLocalDockerVolumes } from '@/lib/docker/volumes';
import { NextResponse } from 'next/server';

// GET /api/docker/volumes — named volumes on this host
export async function GET() {
  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const volumes = await listLocalDockerVolumes();
    return NextResponse.json({ volumes });
  } catch (error) {
    console.error('Failed to list local Docker volumes:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to list Docker volumes',
      },
      { status: 400 }
    );
  }
}
