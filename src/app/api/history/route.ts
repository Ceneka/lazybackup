import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { backupHistory, backupConfigs } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

// GET /api/history - Get backup history with related config information
export async function GET(request: NextRequest) {
  try {
    // Fetch backup history entries with their related backup configs
    const history = await db.query.backupHistory.findMany({
      with: {
        backupConfig: {
          with: {
            server: true,
          },
        },
      },
      orderBy: [desc(backupHistory.startTime)],
    });
    
    return NextResponse.json(history);
  } catch (error) {
    console.error('Failed to fetch backup history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history' },
      { status: 500 }
    );
  }
} 
