import { db } from '@/lib/db';
import { backupConfigs } from '@/lib/db/schema';
import { scheduleBackup } from '@/lib/scheduler';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Backup config validation schema
const backupConfigSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  name: z.string().min(1, 'Name is required'),
  sourcePath: z.string().min(1, 'Source path is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  schedule: z.string().min(1, 'Schedule is required'),
  excludePatterns: z.string().optional(),
  enabled: z.boolean().default(true),
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
    
    return NextResponse.json(config);
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
      scheduleBackup(updatedConfig);
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
