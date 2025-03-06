import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { testConnection } from '@/lib/ssh';

// GET /api/servers/:id/test - Test server connection
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
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
    
    // Test the connection
    const result = await testConnection(server);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to test server connection:', error);
    return NextResponse.json(
      { 
        error: 'Failed to test server connection',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 
