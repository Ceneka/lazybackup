import { databaseConnectionTestSchema } from '@/lib/backup/schema';
import {
  connectionFromConfig,
  testDatabaseConnectionLocal,
  testDatabaseConnectionRemote,
} from '@/lib/database';
import { db } from '@/lib/db';
import { servers } from '@/lib/db/schema';
import { connectToServer } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// POST /api/backups/database/test — probe SELECT 1 without persisting
export async function POST(request: NextRequest) {
  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
      return NextResponse.json(
        { error: 'Not in Node.js environment' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const data = databaseConnectionTestSchema.parse(body);
    const conn = connectionFromConfig({
      dbEngine: data.dbEngine,
      dbClient: data.dbClient,
      dbContainer: data.dbContainer,
      dbHost: data.dbHost,
      dbPort: data.dbPort,
      dbUser: data.dbUser,
      dbPassword: data.dbPassword,
      sourcePath: data.sourcePath,
    });

    if (data.sourceKind === 'local') {
      const result = await testDatabaseConnectionLocal(conn);
      return NextResponse.json({ success: true, result: result.stdout });
    }

    const server = await db.query.servers.findFirst({
      where: eq(servers.id, data.serverId!),
    });
    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    const ssh = await connectToServer({
      ...server,
      password: server.password || null,
      privateKey: server.privateKey || null,
      sshKeyId: server.sshKeyId || null,
      systemKeyPath: server.systemKeyPath || null,
    });

    try {
      const result = await testDatabaseConnectionRemote(ssh, conn);
      return NextResponse.json({ success: true, result: result.stdout });
    } finally {
      ssh.dispose();
    }
  } catch (error) {
    console.error('Database connection test failed:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : 'Database connection test failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
