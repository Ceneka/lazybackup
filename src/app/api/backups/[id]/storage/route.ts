import { db } from "@/lib/db"
import { backupConfigs } from "@/lib/db/schema"
import { getBackupDestinationSummary } from "@/lib/backup/storage-stats"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export const revalidate = 0

/**
 * GET /api/backups/:id/storage
 * Summarize files currently stored at this backup's destination.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
      return NextResponse.json(
        { error: "Storage summary is only available in the Node.js runtime" },
        { status: 503 }
      )
    }

    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: {
        destinationServer: true,
      },
    })

    if (!config) {
      return NextResponse.json(
        { error: "Backup configuration not found" },
        { status: 404 }
      )
    }

    const summary = await getBackupDestinationSummary({
      destinationPath: config.destinationPath,
      destinationKind: config.destinationKind,
      destinationServerName: config.destinationServer?.name ?? null,
      enableVersioning: config.enableVersioning,
      versionsToKeep: config.versionsToKeep,
    })

    return NextResponse.json(summary)
  } catch (error) {
    console.error("Failed to summarize backup destination:", error)
    return NextResponse.json(
      { error: "Failed to summarize backup destination" },
      { status: 500 }
    )
  }
}
