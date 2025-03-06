import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/servers/:id - Get a single server
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get the server
    const server = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });
    
    if (!server) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(server);
  } catch (error) {
    console.error('Failed to fetch server:', error);
    return NextResponse.json(
      { error: 'Failed to fetch server' },
      { status: 500 }
    );
  }
} 
