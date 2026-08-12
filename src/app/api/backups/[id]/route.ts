import { redactBackup } from '@/lib/api/redact';
import {
  RemoteExecPermissionError,
  assertCanSetPreBackupCommands,
  resolveAuth,
} from '@/lib/auth';
import { findExactDestinationConflict } from '@/lib/backup/destination-guard';
import { backupConfigSchema } from '@/lib/backup/schema';
import { attachLastValidation } from '@/lib/backup/validate';
import { formatCronExpression } from '@/lib/cron/format';
import { buildUpcomingEntry } from '@/lib/cron/next';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { scheduleBackup, stopBackup } from '@/lib/scheduler';
import { getAppTimezone } from '@/lib/settings/timezone';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const backupWithEndpoints = {
  server: true,
  destinationServer: true,
  sourceS3Profile: true,
  destinationS3Profile: true,
  destinationPeer: true,
} as const;

// GET /api/backups/:id - Get a backup configuration
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get the backup configuration
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    });

    if (!config) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }

    const timeZone = await getAppTimezone();
    const upcoming = config.enabled
      ? buildUpcomingEntry(config, timeZone)
      : {
          ...buildUpcomingEntry(config, timeZone),
          nextRun: null,
          nextRunFormatted: null,
        };

    const redacted = attachLastValidation(
      redactBackup(config as unknown as Record<string, unknown>) as Record<string, unknown>
    );

    return NextResponse.json({
      ...redacted,
      scheduleLabel: formatCronExpression(config.schedule),
      timezone: timeZone,
      nextRun: upcoming.nextRun,
      nextRunFormatted: upcoming.nextRunFormatted,
    });
  } catch (error) {
    console.error('Failed to fetch backup configuration:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup configuration' },
      { status: 500 }
    );
  }
}

// PUT /api/backups/:id - Update a backup configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

    const existing = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }

    assertCanSetPreBackupCommands(
      auth,
      validatedData.preBackupCommands,
      existing.preBackupCommands
    );

    const conflictingBackup = await findExactDestinationConflict(
      validatedData.destinationPath,
      id,
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

    const dbPassword =
      validatedData.dbPassword && String(validatedData.dbPassword).trim()
        ? validatedData.dbPassword
        : existing.dbPassword;

    // First stop any existing cron job
    stopBackup(id);

    // Update the backup configuration (clear stale validation)
    await db.update(backupConfigs)
      .set({
        ...validatedData,
        dbPassword,
        lastValidatedAt: null,
        lastValidationOk: null,
        lastValidationChecks: null,
        updatedAt: new Date(),
      })
      .where(eq(backupConfigs.id, id));

    // Get the updated configuration with server details
    const updatedConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    });

    if (!updatedConfig) {
      return NextResponse.json(
        { error: 'Backup configuration not found' },
        { status: 404 }
      );
    }

    // Reschedule the backup if enabled
    if (updatedConfig.enabled) {
      await scheduleBackup(updatedConfig);
    }

    const redacted = attachLastValidation(
      redactBackup(updatedConfig as unknown as Record<string, unknown>) as Record<
        string,
        unknown
      >
    );

    return NextResponse.json(redacted);
  } catch (error) {
    console.error('Failed to update backup configuration:', error);

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
      { error: 'Failed to update backup configuration' },
      { status: 500 }
    );
  }
}

// DELETE /api/backups/:id - Delete a backup configuration
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // First stop any existing cron job
    stopBackup(id);

    // Delete the backup configuration
    await db.delete(backupConfigs).where(eq(backupConfigs.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete backup configuration:', error);
    return NextResponse.json(
      { error: 'Failed to delete backup configuration' },
      { status: 500 }
    );
  }
}
