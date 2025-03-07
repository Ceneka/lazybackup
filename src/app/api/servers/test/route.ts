import { NextRequest, NextResponse } from 'next/server';

// POST /api/servers/test - Test server connection and backup capabilities from form data
export async function POST(request: NextRequest) {
    try {
        if (process.env.NEXT_RUNTIME !== 'nodejs') {
            return NextResponse.json(
                { error: 'Not in Node.js environment' },
                { status: 500 }
            );
        }

        // Get server data from request body
        const serverData = await request.json();

        // Ensure required fields are present
        if (!serverData.host || !serverData.username || !serverData.authType) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Import the test function
        const { testServerBackupCapabilities } = await import('@/lib/ssh');

        // Test the connection and backup capabilities
        const result = await testServerBackupCapabilities(serverData);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to test server connection:', error);
        return NextResponse.json(
            {
                error: 'Failed to test server connection',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
} 
