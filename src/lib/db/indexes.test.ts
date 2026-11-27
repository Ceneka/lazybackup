import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as realDb from '@/lib/db';
import * as schema from './schema';

// Migration target: a throwaway SQLite file, not the repo ./data.db.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-db-indexes-'));
const dbPath = path.join(dir, 'data.db');
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = `file:${dbPath}`;

const client = createClient({ url: `file:${dbPath}` });
const testDb = drizzle(client, { schema });

mock.module('@/lib/db', () => ({ db: testDb }));
const { runMigration } = await import('./migrate');

afterAll(async () => {
  mock.module('@/lib/db', () => realDb);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  client.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const EXPECTED_INDEXES: Record<string, string[]> = {
  idx_backup_history_config_start: ['config_id', 'start_time'],
  idx_backup_history_start: ['start_time'],
  idx_backup_history_mailbox_pending: ['mailbox_pending'],
  idx_backup_history_status_start: ['status', 'start_time'],
};

async function indexColumns(name: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA index_info('${name}')`);
  return result.rows.map((row) => String(row.name));
}

describe('backup_history indexes', () => {
  beforeAll(async () => {
    await runMigration();
  });

  test('migrate creates every hot-path history index', async () => {
    for (const [name, columns] of Object.entries(EXPECTED_INDEXES)) {
      expect(await indexColumns(name)).toEqual(columns);
    }
  });

  test('migrate is idempotent and keeps the indexes', async () => {
    await runMigration();
    for (const [name, columns] of Object.entries(EXPECTED_INDEXES)) {
      expect(await indexColumns(name)).toEqual(columns);
    }
  });

  test('adds the nullable delivery_error column', async () => {
    const result = await client.execute('PRAGMA table_info(backup_history)');
    const column = result.rows.find((row) => row.name === 'delivery_error');
    expect(column).toBeDefined();
    expect(Number(column?.notnull ?? 1)).toBe(0);
  });

  test('the peers pending query is covered by an index', async () => {
    // STRICT: the query planner must be able to use the mailbox_pending index.
    const plan = await testDb.run(
      sql`EXPLAIN QUERY PLAN SELECT id FROM backup_history WHERE mailbox_pending = 1`
    );
    const detail = plan.rows.map((row) => String(row.detail ?? '')).join('\n');
    expect(detail).toContain('idx_backup_history_mailbox_pending');
  });
});
