import { redactServer } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { backupConfigs, servers, sshKeys } from '@/lib/db/schema';
import {
  serverInputSchema,
  validateServerCredentials,
  validateSshKeyMaterial,
} from '@/lib/ssh/key-validate';
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

/** 400 with a field path the form can highlight (same shape as Zod issues). */
function fieldError(field: string, message: string) {
  return NextResponse.json(
    { error: message, details: [{ path: [field], message }] },
    { status: 400 }
  );
}

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
      with: { sshKey: { columns: { id: true, name: true } } },
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
      ...redactServer(server as unknown as Record<string, unknown>),
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
    const validatedData = serverInputSchema.parse(body);

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

    // Blank secrets on update mean "keep the stored value"; explicit null clears.
    const password =
      validatedData.password && validatedData.password.trim()
        ? validatedData.password
        : existingServer.password;
    const privateKey =
      validatedData.privateKey && validatedData.privateKey.trim()
        ? validatedData.privateKey
        : existingServer.privateKey;
    const sshKeyId =
      validatedData.sshKeyId !== undefined
        ? validatedData.sshKeyId?.trim() || null
        : existingServer.sshKeyId;
    const systemKeyPath =
      validatedData.systemKeyPath !== undefined
        ? validatedData.systemKeyPath?.trim() || null
        : existingServer.systemKeyPath;

    // A stored key must exist and hold material node-ssh can actually load.
    if (validatedData.authType === 'key' && sshKeyId) {
      const storedKey = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, sshKeyId),
      });

      if (!storedKey) {
        return fieldError('sshKeyId', 'Selected SSH key not found');
      }

      const storedKeyCheck = await validateSshKeyMaterial(storedKey);
      if (!storedKeyCheck.ok) {
        return fieldError(
          'sshKeyId',
          `Selected SSH key is unusable: ${storedKeyCheck.message}`
        );
      }
    }

    // Key auth needs usable key material; password auth needs a password.
    const credentialCheck = await validateServerCredentials({
      authType: validatedData.authType,
      password,
      privateKey,
      sshKeyId,
      systemKeyPath,
    });
    if (!credentialCheck.ok) {
      return fieldError(credentialCheck.field, credentialCheck.message);
    }

    // Update the server
    await db.update(servers)
      .set({
        name: validatedData.name,
        host: validatedData.host,
        port: validatedData.port,
        username: validatedData.username,
        authType: validatedData.authType,
        password: validatedData.authType === 'password' ? password ?? null : null,
        privateKey:
          validatedData.authType === 'key'
            ? privateKey?.trim() || null
            : null,
        sshKeyId: validatedData.authType === 'key' ? sshKeyId : null,
        systemKeyPath:
          validatedData.authType === 'key' ? systemKeyPath : null,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id));

    // Get the updated server
    const updatedServer = await db.query.servers.findFirst({
      where: eq(servers.id, id),
    });

    return NextResponse.json(
      updatedServer
        ? redactServer(updatedServer as unknown as Record<string, unknown>)
        : updatedServer
    );
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
