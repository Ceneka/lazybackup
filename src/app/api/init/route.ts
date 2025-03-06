import { db } from '@/lib/db';
import { runMigration } from '@/lib/db/migrate';
import { backupConfigs, backupHistory, servers } from '@/lib/db/schema';
import { initializeServer } from '@/lib/init';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// Manual initialization endpoint
export async function GET(request: NextRequest) {
  try {
    // Check if force reinitialization is requested
    const force = request.nextUrl.searchParams.get('force') === 'true';
    
    // Run database migrations
    await runMigration();
    
    // Initialize server components (scheduler, etc.)
    const initResult = await initializeServer(force);
    if (!initResult.success) {
      throw new Error(initResult.message);
    }
    
    // Count tables
    const serversResult = await db.select({ count: sql`count(*)` }).from(servers);
    const backupsResult = await db.select({ count: sql`count(*)` }).from(backupConfigs);
    const historyResult = await db.select({ count: sql`count(*)` }).from(backupHistory);
    
    return NextResponse.json({
      initialized: true,
      message: `Server ${force ? 'forcefully ' : ''}initialized successfully`,
      counts: {
        servers: Number(serversResult[0]?.count || 0),
        backups: Number(backupsResult[0]?.count || 0),
        history: Number(historyResult[0]?.count || 0),
      }
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize' },
      { status: 500 }
    );
  }
} 
