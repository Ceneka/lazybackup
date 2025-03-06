import { restartScheduler } from '@/lib/scheduler';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/scheduler/restart - Restart the backup scheduler
export async function POST(request: NextRequest) {
  try {
    await restartScheduler();
    return NextResponse.json({ success: true, message: 'Scheduler restarted successfully' });
  } catch (error) {
    console.error('Failed to restart scheduler:', error);
    return NextResponse.json(
      { error: 'Failed to restart scheduler' },
      { status: 500 }
    );
  }
} 
