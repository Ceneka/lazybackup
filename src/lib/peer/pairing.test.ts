import { describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { peerInvites } from '@/lib/db/schema';
import { consumePendingInvite } from './pairing';

describe('consumePendingInvite', () => {
  test('only one concurrent claim succeeds', async () => {
    const client = createClient({ url: ':memory:' });
    const testdb = drizzle(client, { schema: { peerInvites } });
    await client.execute(`
      CREATE TABLE peer_invites (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        quota_bytes INTEGER NOT NULL,
        local_base_url TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at INTEGER NOT NULL,
        peer_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await testdb.insert(peerInvites).values({
      id: 'inv-1',
      code: 'ABCD-EFGH',
      secretHash: 'hash',
      quotaBytes: 1,
      localBaseUrl: 'https://example.com',
      label: 'Test',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });

    const [a, b] = await Promise.all([
      consumePendingInvite('inv-1', testdb),
      consumePendingInvite('inv-1', testdb),
    ]);
    expect(Number(a) + Number(b)).toBe(1);

    const third = await consumePendingInvite('inv-1', testdb);
    expect(third).toBe(false);
  });
});
