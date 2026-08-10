import { restoreDockerVolumeBackup } from '@/lib/backup';
import { isValidDockerVolumeName } from '@/lib/docker/volumes';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const restoreSchema = z.object({
  volumeName: z.string().min(1).optional(),
});

// POST /api/history/[id]/restore - Restore a Docker volume backup
export async function POST(
  request: NextRequest,
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

    const body = await request.json().catch(() => ({}));
    const { volumeName } = restoreSchema.parse(body);

    if (volumeName && !isValidDockerVolumeName(volumeName)) {
      return NextResponse.json(
        { error: 'Invalid Docker volume name' },
        { status: 400 }
      );
    }

    const result = await restoreDockerVolumeBackup(id, volumeName);

    return NextResponse.json({
      success: true,
      volumeName: result.volumeName,
      log: result.log,
    });
  } catch (error) {
    console.error(`Failed to restore backup ${id}:`, error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to restore backup';
    const status =
      message.includes('not found') || message.includes('Only successful') || message.includes('only supported')
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
