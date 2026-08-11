import { db } from '@/lib/db';
import { backupConfigs, s3Profiles } from '@/lib/db/schema';
import { s3ProfileSchema } from '@/lib/s3/schema';
import { eq, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

function backupRolesForProfile(
  backup: {
    sourceS3ProfileId: string | null;
    destinationS3ProfileId: string | null;
  },
  profileId: string
): Array<'source' | 'destination'> {
  const roles: Array<'source' | 'destination'> = [];
  if (backup.sourceS3ProfileId === profileId) roles.push('source');
  if (backup.destinationS3ProfileId === profileId) roles.push('destination');
  return roles;
}

// GET /api/s3-profiles/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });

    if (!profile) {
      return NextResponse.json({ error: 'S3 profile not found' }, { status: 404 });
    }

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: or(
        eq(backupConfigs.sourceS3ProfileId, id),
        eq(backupConfigs.destinationS3ProfileId, id)
      ),
      columns: {
        id: true,
        name: true,
        sourceS3ProfileId: true,
        destinationS3ProfileId: true,
      },
    });

    return NextResponse.json({
      ...profile,
      usedByBackups: referencingBackups.map((backup) => ({
        id: backup.id,
        name: backup.name,
        roles: backupRolesForProfile(backup, id),
      })),
    });
  } catch (error) {
    console.error('Failed to fetch S3 profile:', error);
    return NextResponse.json({ error: 'Failed to fetch S3 profile' }, { status: 500 });
  }
}

// PUT /api/s3-profiles/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = s3ProfileSchema.parse(body);

    const existing = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: 'S3 profile not found' }, { status: 404 });
    }

    await db
      .update(s3Profiles)
      .set({ ...validatedData, updatedAt: new Date() })
      .where(eq(s3Profiles.id, id));

    const updated = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update S3 profile:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to update S3 profile' }, { status: 500 });
  }
}

// DELETE /api/s3-profiles/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: 'S3 profile not found' }, { status: 404 });
    }

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: or(
        eq(backupConfigs.sourceS3ProfileId, id),
        eq(backupConfigs.destinationS3ProfileId, id)
      ),
      columns: {
        id: true,
        name: true,
        sourceS3ProfileId: true,
        destinationS3ProfileId: true,
      },
    });

    if (referencingBackups.length > 0) {
      return NextResponse.json(
        {
          error: 'S3 profile is used by backups',
          backups: referencingBackups.map((backup) => ({
            id: backup.id,
            name: backup.name,
            roles: backupRolesForProfile(backup, id),
          })),
        },
        { status: 409 }
      );
    }

    await db.delete(s3Profiles).where(eq(s3Profiles.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete S3 profile:', error);
    return NextResponse.json({ error: 'Failed to delete S3 profile' }, { status: 500 });
  }
}
