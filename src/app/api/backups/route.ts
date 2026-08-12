import { redactBackup } from '@/lib/api/redact';
import {
  RemoteExecPermissionError,
  assertCanSetPreBackupCommands,
  resolveAuth,
} from '@/lib/auth';
import { findExactDestinationConflict } from '@/lib/backup/destination-guard';
import { backupConfigSchema } from '@/lib/backup/schema';
import { attachLastValidation } from '@/lib/backup/validate';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const backupWithEndpoints = {
  server: true,
  destinationServer: true,
  sourceS3Profile: true,
  destinationS3Profile: true,
  destinationPeer: true,
} as const;

// GET /api/backups - List all backup configurations
export async function GET() {
  try {
    const configs = await db.query.backupConfigs.findMany({
      with: backupWithEndpoints,
    });

    return NextResponse.json(
      configs.map((c) =>
        attachLastValidation(
          redactBackup(c as unknown as Record<string, unknown>) as Record<string, unknown>
        )
      )
    );
  } catch (error) {
    console.error('Failed to fetch backup configurations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup configurations' },
      { status: 500 }
    );
  }
}

// POST /api/backups - Create a new backup configuration
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuth(
      request.headers.get('cookie'),
      request.headers.get('authorization')
    );
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate the request body
    const validatedData = backupConfigSchema.parse(body);
    assertCanSetPreBackupCommands(auth, validatedData.preBackupCommands);

    const conflictingBackup = await findExactDestinationConflict(
      validatedData.destinationPath,
      undefined,
      {
        destinationKind: validatedData.destinationKind,
        destinationServerId: validatedData.destinationServerId,
        destinationS3ProfileId: validatedData.destinationS3ProfileId,
        destinationPeerId: validatedData.destinationPeerId,
      }
    );
    if (conflictingBackup) {
      return NextResponse.json(
        {
          error: `Destination path is already used by backup "${conflictingBackup.name}"`,
          conflictingBackup,
        },
        { status: 409 }
      );
    }

    // Create a new backup configuration
    const newConfig = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the backup configuration into the database
    await db.insert(backupConfigs).values(newConfig);

    // Get the complete configuration with server details
    const completeConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, newConfig.id),
      with: backupWithEndpoints,
    });

    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const { scheduleBackup } = await import('@/lib/scheduler');

    // Schedule the backup if enabled
    if (completeConfig && completeConfig.enabled) {
      await scheduleBackup(completeConfig);
    }

    return NextResponse.json(
      completeConfig
        ? attachLastValidation(
            redactBackup(completeConfig as unknown as Record<string, unknown>) as Record<
              string,
              unknown
            >
          )
        : completeConfig,
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to create backup configuration:', error);

    if (error instanceof RemoteExecPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create backup configuration' },
      { status: 500 }
    );
  }
}
