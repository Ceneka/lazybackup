import { getCachedBackupStorageStats } from "@/lib/backup/storage-stats"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/dashboard/storage - Local backup storage totals (BACKUP_STORAGE_PATH).
 * Split from /api/dashboard because the walk can take seconds on large trees;
 * results are cached server-side (see getCachedBackupStorageStats).
 */
export async function GET() {
  try {
    return NextResponse.json(await getCachedBackupStorageStats())
  } catch (error) {
    console.error("Error fetching storage stats:", error)
    return NextResponse.json(
      { error: "Failed to fetch storage stats" },
      { status: 500 }
    )
  }
}
