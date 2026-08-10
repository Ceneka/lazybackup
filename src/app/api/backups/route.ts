import { findExactDestinationConflict } from '@/lib/backup/destination-guard';
import { backupConfigSchema } from '@/lib/backup/schema';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// GET /api/backups - List all backup configurations
export async function GET() {
  try {
    const configs = await db.query.backupConfigs.findMany({
      with: {
        server: true,
      },
    });

    return NextResponse.json(configs);
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
    const body = await request.json();

    // Validate the request body
    const validatedData = backupConfigSchema.parse(body);

    const conflictingBackup = await findExactDestinationConflict(
      validatedData.destinationPath
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
      with: {
        server: true,
      },
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

    return NextResponse.json(completeConfig, { status: 201 });
  } catch (error) {
    console.error('Failed to create backup configuration:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create backup configuration' },
      { status: 500 }
    );
  }
}
