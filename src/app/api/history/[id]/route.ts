import { updateHistorySchema } from '@/lib/backup/history-schema';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// GET /api/history/[id] - Get a specific backup history entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Fetch the specific history entry with related data
    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: {
        backupConfig: {
          with: {
            server: true,
            destinationServer: true,
            sourceS3Profile: true,
            destinationS3Profile: true,
          },
        },
      },
    });
    
    if (!historyEntry) {
      return NextResponse.json(
        { error: 'Backup history entry not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(historyEntry);
  } catch (error) {
    console.error('Error fetching backup history entry:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history entry' },
      { status: 500 }
    );
  }
}

// PUT /api/history/[id] - Update a specific backup history entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = updateHistorySchema.parse(body);
    
    const updatedHistoryEntry = await db
      .update(backupHistory)
      .set(validated)
      .where(eq(backupHistory.id, id))
      .returning();
    
    if (updatedHistoryEntry.length === 0) {
      return NextResponse.json(
        { error: 'Backup history entry not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(updatedHistoryEntry[0]);
  } catch (error) {
    console.error('Error updating backup history entry:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update backup history entry' },
      { status: 500 }
    );
  }
}

// DELETE /api/history/[id] - Delete a specific backup history entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Delete the history entry
    const deletedHistoryEntry = await db
      .delete(backupHistory)
      .where(eq(backupHistory.id, id))
      .returning();
    
    if (deletedHistoryEntry.length === 0) {
      return NextResponse.json(
        { error: 'Backup history entry not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { message: 'Backup history entry deleted successfully' }
    );
  } catch (error) {
    console.error('Error deleting backup history entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete backup history entry' },
      { status: 500 }
    );
  }
}
