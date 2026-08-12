import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { NextResponse } from "next/server"

export const revalidate = 0

/**
 * GET /api/health
 * Public health check for Docker / compose. No backup inventory.
 */
export async function GET() {
    try {
        await db.run(sql`SELECT 1`)

        return NextResponse.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
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
