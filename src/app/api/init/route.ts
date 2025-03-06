import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { servers, backupConfigs, backupHistory } from '@/lib/db/schema';
import { runMigration } from '@/lib/db/migrate';
import { sql } from 'drizzle-orm';

// Initialize the database
export async function GET(request: NextRequest) {
  try {
    // Run database migrations
    await runMigration();
    
    // Count tables to check if initialization is needed
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
    console.error('Failed to initialize database:', error);
    return NextResponse.json(
      { error: 'Failed to initialize database' },
      { status: 500 }
    );
  }
} 
