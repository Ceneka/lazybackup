import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { testConnection } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

// Server validation schema
const serverSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  authType: z.enum(['password', 'key']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
});

// GET /api/servers - List all servers
export async function GET() {
  try {
    const allServers = await db.select().from(servers);
    return NextResponse.json(allServers);
  } catch (error) {
    console.error('Failed to fetch servers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch servers' },
      { status: 500 }
    );
  }
}

// POST /api/servers - Create a new server
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate the request body
    const validatedData = serverSchema.parse(body);
    
    // Create a new server
    const newServer = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Insert the server into the database
    await db.insert(servers).values(newServer);
    
    return NextResponse.json(newServer, { status: 201 });
  } catch (error) {
    console.error('Failed to create server:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to create server' },
      { status: 500 }
    );
  }
}

// PUT /api/servers/:id - Update a server
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const body = await request.json();
    
    // Validate the request body
    const validatedData = serverSchema.parse(body);
    
    // Update the server
    await db.update(servers)
      .set({
        ...validatedData,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id));
    
    // Get the updated server
    const updatedServer = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });
    
    if (!updatedServer) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error('Failed to update server:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to update server' },
      { status: 500 }
    );
  }
}

// DELETE /api/servers/:id - Delete a server
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    
    // Delete the server
    await db.delete(servers).where(eq(servers.id, id));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete server:', error);
    return NextResponse.json(
      { error: 'Failed to delete server' },
      { status: 500 }
    );
  }
} 
