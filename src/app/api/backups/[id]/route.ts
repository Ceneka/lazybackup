import { formatCronExpression } from '@/lib/cron/format';
import { buildUpcomingEntry } from '@/lib/cron/next';
import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { scheduleBackup, stopBackup } from '@/lib/scheduler';
import { getAppTimezone } from '@/lib/settings/timezone';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Backup config validation schema
const backupConfigSchema = z
  .object({
    serverId: z.string().min(1, 'Server ID is required'),
    name: z.string().min(1, 'Name is required'),
    sourcePath: z.string().min(1, 'Source path is required'),
    destinationPath: z.string().min(1, 'Destination path is required'),
    schedule: z.string().min(1, 'Schedule is required'),
    excludePatterns: z.string().optional(),
    preBackupCommands: z.string().optional(),
    enabled: z.boolean().default(true),
    enableVersioning: z.boolean().default(false),
    versionsToKeep: z.coerce.number().min(1).max(100).optional().default(5),
    enableFileRetention: z.boolean().default(false),
    retentionMaxAge: z.coerce.number().min(1).max(3650).optional().default(30),
    retentionMaxAgeUnit: z.enum(['days', 'months']).default('days'),
    retentionMinKeep: z.coerce.number().min(1).max(10000).optional().default(5),
  })
  .superRefine((data, ctx) => {
    if (data.enableVersioning && data.enableFileRetention) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File retention cannot be enabled together with versioning',
        path: ['enableFileRetention'],
      });
    }
  });

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
      with: {
        server: true,
      },
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

    return NextResponse.json({
      ...config,
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
    const body = await request.json();

    // Validate the request body
    const validatedData = backupConfigSchema.parse(body);

    // First stop any existing cron job
    stopBackup(id);

    // Update the backup configuration
    await db.update(backupConfigs)
      .set({
        ...validatedData,
        updatedAt: new Date(),
      })
      .where(eq(backupConfigs.id, id));

    // Get the updated configuration with server details
    const updatedConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        server: true,
      },
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

    return NextResponse.json(updatedConfig);
  } catch (error) {
    console.error('Failed to update backup configuration:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
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
