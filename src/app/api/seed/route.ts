import { seedDemoData } from '@/lib/db/seed-demo';
import { NextResponse } from 'next/server';

/**
 * POST /api/seed — Replace app data with screenshot-friendly demo fixtures.
 * Dev / local only. Does not touch auth password settings.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Seed is disabled in production' }, { status: 403 });
  }

  try {
    const result = await seedDemoData();
    return NextResponse.json(
      {
        message: 'Demo data seeded for screenshots',
        ...result,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to seed database:', error);
    return NextResponse.json({ error: 'Failed to seed database' }, { status: 500 });
  }
}
