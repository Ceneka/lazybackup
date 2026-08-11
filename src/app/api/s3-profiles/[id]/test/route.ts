import { db } from '@/lib/db';
import { s3Profiles } from '@/lib/db/schema';
import { testS3Connection } from '@/lib/s3';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/s3-profiles/:id/test
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
    await testS3Connection(profile);
    return NextResponse.json({ success: true, message: 'S3 connection OK' });
  } catch (error) {
    console.error('S3 profile test failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'S3 connection failed',
      },
      { status: 400 }
    );
  }
}
