import { db } from '@/lib/db';
import { backupConfigs, backupHistory, servers } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// Get server status
export async function GET(request: NextRequest) {
  try {
    // Count tables to check if the database is initialized
    const serversResult = await db.select({ count: sql`count(*)` }).from(servers);
    const backupsResult = await db.select({ count: sql`count(*)` }).from(backupConfigs);
    const historyResult = await db.select({ count: sql`count(*)` }).from(backupHistory);
    
    return NextResponse.json({
      initialized: true,
      counts: {
        servers: Number(serversResult[0]?.count || 0),
        backups: Number(backupsResult[0]?.count || 0),
        history: Number(historyResult[0]?.count || 0),
      }
    });
  } catch (error) {
    console.error('Failed to check server status:', error);
    return NextResponse.json(
      { initialized: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 
