import { db } from '@/lib/db';
import { backupConfigs, servers, sshKeys } from '@/lib/db/schema';
import { eq, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

function backupRolesForServer(
  backup: { serverId: string | null; destinationServerId: string | null },
  serverId: string
): Array<'source' | 'destination'> {
  const roles: Array<'source' | 'destination'> = [];
  if (backup.serverId === serverId) roles.push('source');
  if (backup.destinationServerId === serverId) roles.push('destination');
  return roles;
}

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

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: or(
        eq(backupConfigs.serverId, id),
        eq(backupConfigs.destinationServerId, id)
      ),
      columns: {
        id: true,
        name: true,
        serverId: true,
        destinationServerId: true,
      },
    });

    return NextResponse.json({
      ...server,
      usedByBackups: referencingBackups.map((backup) => ({
        id: backup.id,
        name: backup.name,
        roles: backupRolesForServer(backup, id),
      })),
    });
  } catch (error) {
    console.error('Failed to fetch server:', error);
    return NextResponse.json(
      { error: 'Failed to fetch server' },
      { status: 500 }
    );
  }
}

// PUT /api/servers/:id - Update a server
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate the request body
    const validatedData = serverSchema.parse(body);

    // Check if server exists
    const existingServer = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });

    if (!existingServer) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }

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

    return NextResponse.json(updatedServer);
  } catch (error) {
    console.error('Failed to update server:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if server exists
    const existingServer = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });

    if (!existingServer) {
      return NextResponse.json(
        { error: 'Server not found' },
        { status: 404 }
      );
    }

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: or(
        eq(backupConfigs.serverId, id),
        eq(backupConfigs.destinationServerId, id)
      ),
      columns: {
        id: true,
        name: true,
        serverId: true,
        destinationServerId: true,
      },
    });

    if (referencingBackups.length > 0) {
      return NextResponse.json(
        {
          error:
            'Server is used by backup configurations. Delete or reassign those backups first.',
          backups: referencingBackups.map((backup) => ({
            id: backup.id,
            name: backup.name,
            roles: backupRolesForServer(backup, id),
          })),
        },
        { status: 409 }
      );
    }

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
