import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/history - Get backup history with related config information
export async function GET(request: NextRequest) {
  try {
    // Get query parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;
    const status = searchParams.get('status');
    const configId = searchParams.get('configId');
    
    // Build the query conditions
    let whereClause = undefined;
    
    if (status || configId) {
      const conditions = [];
      
      if (status && (status === 'running' || status === 'success' || status === 'failed')) {
        conditions.push(eq(backupHistory.status, status));
      }
      
      if (configId) {
        conditions.push(eq(backupHistory.configId, configId));
      }
      
      if (conditions.length > 0) {
        whereClause = and(...conditions);
      }
    }
    
    // Fetch backup history entries with their related backup configs
    const history = await db.query.backupHistory.findMany({
      where: whereClause,
      with: {
        backupConfig: {
          with: {
            server: true,
          },
        },
      },
      orderBy: [desc(backupHistory.startTime)],
      limit,
      offset,
    });
    
    // Count total records for pagination
    const countQuery = await db
      .select({ count: sql`count(*)` })
      .from(backupHistory)
      .where(whereClause);
    
    const total = Number(countQuery[0]?.count || 0);
    
    return NextResponse.json({
      history,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + history.length < total,
      },
    });
  } catch (error) {
    console.error('Error fetching backup history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history' },
      { status: 500 }
    );
  }
}

// POST /api/history - Create a new backup history entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.configId || !body.status) {
      return NextResponse.json(
        { error: 'Required fields missing: configId and status are required' },
        { status: 400 }
      );
    }
    
    // Set id if not provided
    if (!body.id) {
      body.id = crypto.randomUUID();
    }
    
    // Set startTime to now if not provided
    if (!body.startTime) {
      body.startTime = new Date();
    }
    
    // Insert new history entry
    const newHistoryEntry = await db.insert(backupHistory).values(body).returning();
    
    return NextResponse.json(newHistoryEntry[0], { status: 201 });
  } catch (error) {
    console.error('Error creating backup history entry:', error);
    return NextResponse.json(
      { error: 'Failed to create backup history entry' },
      { status: 500 }
    );
  }
} 
