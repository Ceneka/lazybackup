import { redactS3ForAudience } from '@/lib/api/redact';
import { resolveAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { s3Profiles } from '@/lib/db/schema';
import {
  validateS3ProfileForWrite,
  type S3ProfileWriteIssue,
} from '@/lib/s3/bucket';
import { s3ProfileSchema } from '@/lib/s3/schema';
import { nanoid } from 'nanoid';
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

// GET /api/s3-profiles
export async function GET(request: NextRequest) {
  try {
    const via = await audience(request);
    const profiles = await db.select().from(s3Profiles);
    return NextResponse.json(
      profiles.map((p) =>
        redactS3ForAudience(p as unknown as Record<string, unknown>, via)
      )
    );
  } catch (error) {
    console.error('Failed to fetch S3 profiles:', error);
    return NextResponse.json({ error: 'Failed to fetch S3 profiles' }, { status: 500 });
  }
}

// POST /api/s3-profiles
export async function POST(request: NextRequest) {
  try {
    const via = await audience(request);
    const body = await request.json();
    const validatedData = s3ProfileSchema.parse(body);

    const writeIssues = validateS3ProfileForWrite(validatedData);
    if (writeIssues.length > 0) return fieldError(writeIssues);

    const newProfile = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(s3Profiles).values(newProfile);
    return NextResponse.json(
      redactS3ForAudience(newProfile as unknown as Record<string, unknown>, via),
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to create S3 profile:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to create S3 profile' }, { status: 500 });
  }
}
