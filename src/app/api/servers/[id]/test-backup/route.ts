import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/servers/:id/test-backup - Test server backup capabilities
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get the server
        const server = await db.query.servers.findFirst({
            where: eq(servers.id, id),
        });

        if (!server) {
            return NextResponse.json(
                { error: 'Server not found' },
                { status: 404 }
            );
        }

        if (process.env.NEXT_RUNTIME !== 'nodejs') {
            return NextResponse.json(
                { error: 'Not in Node.js environment' },
                { status: 500 }
            );
        }

        const { testServerBackupCapabilities } = await import('@/lib/ssh');

        // Test the backup capabilities
        const result = await testServerBackupCapabilities(server);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to test server backup capabilities:', error);
        return NextResponse.json(
            {
                error: 'Failed to test server backup capabilities',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
} 
