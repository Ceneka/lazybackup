import { redactServer } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { servers, sshKeys } from '@/lib/db/schema';
import {
  serverInputSchema,
  validateServerCredentials,
  validateSshKeyMaterial,
} from '@/lib/ssh/key-validate';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/** 400 with a field path the form can highlight (same shape as Zod issues). */
function fieldError(field: string, message: string) {
  return NextResponse.json(
    { error: message, details: [{ path: [field], message }] },
    { status: 400 }
  );
}

// GET /api/servers - List all servers
export async function GET() {
  try {
    const allServers = await db.query.servers.findMany({
      with: { sshKey: { columns: { id: true, name: true } } },
    });
    return NextResponse.json(
      allServers.map((s) => redactServer(s as unknown as Record<string, unknown>))
    );
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
    const validatedData = serverInputSchema.parse(body);

    // A stored key must exist and hold material node-ssh can actually load.
    const sshKeyId = validatedData.sshKeyId?.trim() || null;
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

    // Password auth needs a password on create; key auth needs usable material.
    const credentialCheck = await validateServerCredentials({
      authType: validatedData.authType,
      password: validatedData.password,
      privateKey: validatedData.privateKey,
      sshKeyId,
      systemKeyPath: validatedData.systemKeyPath,
    });
    if (!credentialCheck.ok) {
      return fieldError(credentialCheck.field, credentialCheck.message);
    }

    // Create a new server (only store fields for the selected auth method)
    const newServer = {
      id: nanoid(),
      name: validatedData.name,
      host: validatedData.host,
      port: validatedData.port,
      username: validatedData.username,
      authType: validatedData.authType,
      password:
        validatedData.authType === 'password'
          ? validatedData.password ?? null
          : null,
      privateKey:
        validatedData.authType === 'key'
          ? validatedData.privateKey?.trim() || null
          : null,
      sshKeyId: validatedData.authType === 'key' ? sshKeyId : null,
      systemKeyPath:
        validatedData.authType === 'key'
          ? validatedData.systemKeyPath?.trim() || null
          : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the server into the database
    await db.insert(servers).values(newServer);

    return NextResponse.json(
      redactServer(newServer as unknown as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to create server:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create server' },
      { status: 500 }
    );
  }
}
