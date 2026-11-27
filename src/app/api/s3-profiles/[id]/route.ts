import { redactS3ForAudience } from '@/lib/api/redact';
import { resolveAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { backupConfigs, s3Profiles } from '@/lib/db/schema';
import {
  validateS3ProfileForWrite,
  type S3ProfileWriteIssue,
} from '@/lib/s3/bucket';
import { s3ProfileUpdateSchema } from '@/lib/s3/schema';
import { eq, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/** 400 with a field path the form can highlight (same shape as Zod issues). */
function fieldError(issues: S3ProfileWriteIssue[]) {
  return NextResponse.json(
    { error: issues[0]!.message, details: issues },
    { status: 400 }
  );
}

async function audience(request: NextRequest) {
  const auth = await resolveAuth(
    request.headers.get('cookie'),
    request.headers.get('authorization')
  );
  return auth.via;
}

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const via = await audience(request);
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
      ...redactS3ForAudience(profile as unknown as Record<string, unknown>, via),
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
    const via = await audience(request);
    const body = await request.json();
    const validatedData = s3ProfileUpdateSchema.parse(body);

    // Validate the incoming values only: an old invalid bucket/endpoint must
    // not block unrelated edits (or fixing it one field at a time).
    const writeIssues = validateS3ProfileForWrite(validatedData);
    if (writeIssues.length > 0) return fieldError(writeIssues);

    const existing = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: 'S3 profile not found' }, { status: 404 });
    }

    const secretAccessKey =
      validatedData.secretAccessKey && validatedData.secretAccessKey.trim()
        ? validatedData.secretAccessKey
        : existing.secretAccessKey;

    await db
      .update(s3Profiles)
      .set({
        name: validatedData.name,
        endpoint: validatedData.endpoint,
        region: validatedData.region,
        bucket: validatedData.bucket,
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey,
        forcePathStyle: validatedData.forcePathStyle,
        updatedAt: new Date(),
      })
      .where(eq(s3Profiles.id, id));

    const updated = await db.query.s3Profiles.findFirst({
      where: eq(s3Profiles.id, id),
    });
    return NextResponse.json(
      updated
        ? redactS3ForAudience(updated as unknown as Record<string, unknown>, via)
        : updated
    );
  } catch (error) {
    console.error('Failed to update S3 profile:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
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
