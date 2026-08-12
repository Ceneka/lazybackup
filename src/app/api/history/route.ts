import { historyBackupConfigWith } from '@/lib/api/history-query';
import { redactHistoryEntry } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { backupConfigs, backupHistory, servers } from '@/lib/db/schema';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// GET /api/history - Get backup history with related config information
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 1000;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;
    const status = searchParams.get('status');
    // backupId is accepted as an alias used by older UI links
    const configId = searchParams.get('configId') || searchParams.get('backupId');
    const search = searchParams.get('search')?.trim() || '';

    const conditions = [];

    if (status && (status === 'running' || status === 'success' || status === 'failed')) {
      conditions.push(eq(backupHistory.status, status));
    }

    if (configId) {
      conditions.push(eq(backupHistory.configId, configId));
    }

    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      const matchingConfigs = await db
        .select({ id: backupConfigs.id })
        .from(backupConfigs)
        .leftJoin(servers, eq(backupConfigs.serverId, servers.id))
        .where(
          or(
            like(backupConfigs.name, pattern),
            like(servers.name, pattern),
            like(backupConfigs.sourcePath, pattern),
            like(backupConfigs.destinationPath, pattern)
          )
        );

      const ids = matchingConfigs.map((row) => row.id);
      if (ids.length === 0) {
        return NextResponse.json({
          history: [],
          pagination: {
            total: 0,
            limit,
            offset,
            hasMore: false,
          },
          filters: { status: status || null, configId: configId || null, search },
        });
      }
      conditions.push(inArray(backupHistory.configId, ids));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const history = await db.query.backupHistory.findMany({
      where: whereClause,
      with: {
        backupConfig: historyBackupConfigWith,
      },
      orderBy: [desc(backupHistory.startTime)],
      limit,
      offset,
    });

    const countQuery = await db
      .select({ count: sql`count(*)` })
      .from(backupHistory)
      .where(whereClause);

    const total = Number(countQuery[0]?.count || 0);

    let configName: string | null = null;
    if (configId) {
      const config = await db.query.backupConfigs.findFirst({
        where: eq(backupConfigs.id, configId),
        columns: { name: true },
      });
      configName = config?.name ?? null;
    }

    return NextResponse.json({
      history: history.map((row) =>
        redactHistoryEntry(row as unknown as Record<string, unknown>)
      ),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + history.length < total,
      },
      filters: {
        status: status || null,
        configId: configId || null,
        configName,
        search: search || null,
      },
    });
  } catch (error) {
    console.error('Error fetching backup history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history' },
      { status: 500 }
    );
  }
}
