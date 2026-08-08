import { db } from '@/lib/db';
import { servers, sshKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
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
  sshKeyId: z.string().optional(),
  systemKeyPath: z.string().optional(),
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

    // Validate authentication method
    if (validatedData.authType === 'key') {
      // Ensure at least one key method is provided
      if (!validatedData.privateKey && !validatedData.sshKeyId && !validatedData.systemKeyPath) {
        return NextResponse.json(
          { error: 'When using key authentication, you must provide a private key, select a stored key, or specify a system key path' },
          { status: 400 }
        );
      }

      // If using an SSH key from the database, validate that it exists
      if (validatedData.sshKeyId) {
        const keyExists = await db.query.sshKeys.findFirst({
          where: eq(sshKeys.id, validatedData.sshKeyId),
        });

        if (!keyExists) {
          return NextResponse.json(
            { error: 'Selected SSH key not found' },
            { status: 400 }
          );
        }
      }
    }

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
