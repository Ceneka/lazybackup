import { db } from "@/lib/db"
import { formatBytes } from "@/lib/utils"
import { sql } from "drizzle-orm"
import { readdir, stat } from "fs/promises"
import { NextResponse } from "next/server"
import { join } from "path"

export const revalidate = 0

/**
 * GET /api/health
 * Health check endpoint for Docker
 * Returns basic health status and backup information
 */
export async function GET() {
    try {
        // Basic health check - verify DB connection
        await db.run(sql`SELECT 1`)

        // Get backup information if available
        let backupInfo: {
            count: number;
            totalSize: string;
            latest: { name: string; size: string; date: string } | null
        } = {
            count: 0,
            totalSize: formatBytes(0),
            latest: null
        }

        try {
            const backupPath = process.env.BACKUP_STORAGE_PATH || './backups'
            const files = await readdir(backupPath)
            const backupFiles = files.filter(file => file.endsWith('.zip') || file.endsWith('.sql'))

            let totalSize = 0
            let latestBackup: { name: string; size: string; date: string } | null = null
            let latestTime = 0

            for (const file of backupFiles) {
                const filePath = join(backupPath, file)
                const fileStat = await stat(filePath)
                totalSize += fileStat.size

                if (fileStat.mtimeMs > latestTime) {
                    latestTime = fileStat.mtimeMs
                    latestBackup = {
                        name: file,
                        size: formatBytes(fileStat.size),
                        date: fileStat.mtime.toISOString()
                    }
                }
            }

            backupInfo = {
                count: backupFiles.length,
                totalSize: formatBytes(totalSize),
                latest: latestBackup
            }
        } catch (error) {
            console.error("Error getting backup info:", error)
            // Continue with health check even if backup info fails
        }

        return NextResponse.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            backups: backupInfo
        })
    } catch (error) {
        console.error("Health check failed:", error)
        return NextResponse.json(
            {
                status: "unhealthy",
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        )
    }
} 
