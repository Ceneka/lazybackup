import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';

// POST /api/seed - Add a test server to the database
export async function POST() {
  try {
    // Check if we already have servers
    const existingServers = await db.select().from(servers);
    
    if (existingServers.length > 0) {
      return NextResponse.json({ 
        message: 'Database already has servers', 
        count: existingServers.length 
      });
    }
    
    // Create a test server
    const testServer = {
      id: nanoid(),
      name: 'Test Server',
      host: 'example.com',
      port: 22,
      username: 'testuser',
      authType: 'password' as const,
      password: 'password123', // This is just for testing
      privateKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Insert the test server
    await db.insert(servers).values(testServer);
    
    return NextResponse.json({ 
      message: 'Test server added successfully',
      server: testServer
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to seed database:', error);
    return NextResponse.json(
      { error: 'Failed to seed database' },
      { status: 500 }
    );
  }
} 
