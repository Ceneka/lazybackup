import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/history/stats - Get statistics about backup history
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chartData = searchParams.get('chartData') === 'true';

    // Count total backups
    const totalBackupsQuery = await db
      .select({ count: sql`count(*)` })
      .from(backupHistory);

    const totalBackups = Number(totalBackupsQuery[0]?.count || 0);

    // Count backups by status
    const statusCountsQuery = await db
      .select({
        status: backupHistory.status,
        count: sql`count(*)`,
      })
      .from(backupHistory)
      .groupBy(backupHistory.status);

    const statusCounts = statusCountsQuery.reduce((acc, { status, count }) => {
      acc[status] = Number(count);
      return acc;
    }, { running: 0, success: 0, failed: 0 });

    // Calculate success rate
    const successRate = totalBackups > 0
      ? Math.round((statusCounts.success / totalBackups) * 100)
      : 100;

    // Get average backup size
    const avgSizeQuery = await db
      .select({
        avgSize: sql`avg(${backupHistory.totalSize})`,
      })
      .from(backupHistory)
      .where(sql`${backupHistory.totalSize} IS NOT NULL`);

    const avgSize = Math.round(Number(avgSizeQuery[0]?.avgSize || 0));

    // Get most recent successful backup
    const recentBackup = await db.query.backupHistory.findFirst({
      where: sql`${backupHistory.status} = 'success'`,
      orderBy: [sql`${backupHistory.endTime} DESC`],
      with: {
        backupConfig: true,
      },
    });

    // Fetch chart data if requested
    let chartHistory = null;
    if (chartData) {
      // Fetch the last 10 backup entries for the chart, regardless of status
      chartHistory = await db.query.backupHistory.findMany({
        orderBy: [sql`${backupHistory.startTime} DESC`],
        limit: 10,  // Limit to 10 entries for the chart
        columns: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
        },
      });

      // Sort by date ascending for the chart
      chartHistory = chartHistory.sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      // Ensure we have data for the chart
      console.log(`Chart history data count: ${chartHistory.length}`);
    }

    return NextResponse.json({
      totalBackups,
      statusCounts,
      successRate,
      avgSize,
      recentBackup: recentBackup ? {
        id: recentBackup.id,
        configId: recentBackup.configId,
        configName: recentBackup.backupConfig?.name,
        startTime: recentBackup.startTime,
        endTime: recentBackup.endTime,
        fileCount: recentBackup.fileCount,
        totalSize: recentBackup.totalSize,
      } : null,
      chartHistory: chartHistory,
    });
  } catch (error) {
    console.error('Error fetching backup statistics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup statistics' },
      { status: 500 }
    );
  }
} 
