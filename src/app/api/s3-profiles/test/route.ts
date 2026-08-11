import { testS3Connection } from '@/lib/s3';
import { s3ProfileSchema } from '@/lib/s3/schema';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// POST /api/s3-profiles/test — probe credentials without persisting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = s3ProfileSchema.parse(body);
    await testS3Connection(validatedData);
    return NextResponse.json({ success: true, message: 'S3 connection OK' });
  } catch (error) {
    console.error('S3 connection test failed:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'S3 connection failed',
      },
      { status: 400 }
    );
  }
}
