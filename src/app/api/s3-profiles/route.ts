import { redactS3 } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { s3Profiles } from '@/lib/db/schema';
import { s3ProfileSchema } from '@/lib/s3/schema';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// GET /api/s3-profiles
export async function GET() {
  try {
    const profiles = await db.select().from(s3Profiles);
    return NextResponse.json(
      profiles.map((p) => redactS3(p as unknown as Record<string, unknown>))
    );
  } catch (error) {
    console.error('Failed to fetch S3 profiles:', error);
    return NextResponse.json({ error: 'Failed to fetch S3 profiles' }, { status: 500 });
  }
}

// POST /api/s3-profiles
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = s3ProfileSchema.parse(body);

    const newProfile = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(s3Profiles).values(newProfile);
    return NextResponse.json(
      redactS3(newProfile as unknown as Record<string, unknown>),
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
