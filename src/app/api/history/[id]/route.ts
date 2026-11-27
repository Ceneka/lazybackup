import { historyBackupConfigWith } from '@/lib/api/history-query';
import { redactHistoryEntry } from '@/lib/api/redact';
import { deliveryErrorForHistoryRow } from '@/lib/backup/history';
import {
  parseRestoreSnapshot,
  restoreDefaultsFromSnapshot,
} from '@/lib/backup/restore-snapshot';
import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { deliveryStateForHistoryRow } from '@/lib/peer/delivery-state';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

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
        backupConfig: historyBackupConfigWith,
      },
    });
    
    if (!historyEntry) {
      return NextResponse.json(
        { error: 'Backup history entry not found' },
        { status: 404 }
      );
    }
    
    const snapshot = parseRestoreSnapshot(historyEntry.configSnapshot);
    const restoreDefaults = historyEntry.backupConfig
      ? restoreDefaultsFromSnapshot(snapshot, historyEntry.backupConfig)
      : null;
    const deliveryState = deliveryStateForHistoryRow(historyEntry);
    const deliveryError = deliveryErrorForHistoryRow(historyEntry, deliveryState);

    return NextResponse.json({
      ...redactHistoryEntry(historyEntry as unknown as Record<string, unknown>),
      deliveryState,
      deliveryError,
      // Legacy key the UI still reads; same reason.
      mailboxError: deliveryError,
      restoreDefaults,
    });
  } catch (error) {
    console.error('Error fetching backup history entry:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history entry' },
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

    // Peer artifacts live on the friend's disk: queue a mailbox delete before
    // dropping the row, so the friend's storage is freed on the next sync.
    const existing = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      columns: { id: true, artifactPath: true, artifactRemoved: true },
    });
    if (existing) {
      try {
        const { enqueuePeerDeleteForHistory } = await import('@/lib/peer/retention');
        await enqueuePeerDeleteForHistory(existing);
      } catch (peerError) {
        console.warn('Failed to queue peer delete for history entry:', peerError);
      }
    }

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
