import { databaseConnectionTestSchema } from '@/lib/backup/schema';
import {
  connectionFromConfig,
  testDatabaseConnectionLocal,
  testDatabaseConnectionRemote,
} from '@/lib/database';
import { db } from '@/lib/db';
import { backupConfigs, servers } from '@/lib/db/schema';
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

    // The edit form never receives the stored password. When it asks us to use
    // the saved one, load it here and keep it server-side.
    const useStoredPassword = body?.useStoredPassword === true;
    const backupId = typeof body?.backupId === 'string' ? body.backupId : '';
    let dbPassword = data.dbPassword;
    if (useStoredPassword) {
      if (!backupId) {
        return NextResponse.json(
          { error: 'backupId is required to use the stored password' },
          { status: 400 }
        );
      }
      const stored = await db.query.backupConfigs.findFirst({
        where: eq(backupConfigs.id, backupId),
      });
      if (!stored) {
        return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
      }
      if (!stored.dbPassword) {
        return NextResponse.json(
          { error: 'No stored database password — enter one to test' },
          { status: 400 }
        );
      }
      // Only reuse the secret against the exact saved target. Otherwise any
      // caller allowed to run tests (incl. read-only tokens) could point the
      // stored password at a host they control.
      const norm = (v: unknown) =>
        v === null || v === undefined ? '' : String(v).trim();
      const targetUnchanged =
        norm(data.sourceKind) === norm(stored.sourceKind) &&
        (data.sourceKind !== 'server' ||
          norm(data.serverId) === norm(stored.serverId)) &&
        norm(data.dbEngine) === norm(stored.dbEngine) &&
        norm(data.dbClient) === norm(stored.dbClient) &&
        norm(data.dbContainer) === norm(stored.dbContainer) &&
        norm(data.dbHost) === norm(stored.dbHost) &&
        norm(data.dbPort) === norm(stored.dbPort) &&
        norm(data.dbUser) === norm(stored.dbUser);
      if (!targetUnchanged) {
        return NextResponse.json(
          {
            error:
              'Connection settings changed — enter the database password to test them',
          },
          { status: 400 }
        );
      }
      dbPassword = stored.dbPassword;
    }

    const conn = connectionFromConfig({
      dbEngine: data.dbEngine,
      dbClient: data.dbClient,
      dbContainer: data.dbContainer,
      dbHost: data.dbHost,
      dbPort: data.dbPort,
      dbUser: data.dbUser,
      dbPassword,
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
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : 'Database connection test failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
