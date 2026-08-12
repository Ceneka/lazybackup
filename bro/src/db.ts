import { Database } from 'bun:sqlite';
import path from 'path';
import type { BroConfig } from './config';
import { dbPath, objectsDir } from './config';

let db: Database | null = null;

export function getDb(cfg: BroConfig): Database {
  if (db) return db;
  db = new Database(dbPath(cfg));
  db.exec(`
    CREATE TABLE IF NOT EXISTS objects (
      key TEXT PRIMARY KEY NOT NULL,
      size INTEGER NOT NULL,
      mtime TEXT NOT NULL
    );
  `);
  return db;
}

export function upsertObject(
  cfg: BroConfig,
  key: string,
  size: number,
  mtime: string
): void {
  getDb(cfg)
    .query(
      `INSERT INTO objects (key, size, mtime) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime = excluded.mtime`
    )
    .run(key, size, mtime);
}

export function listObjects(
  cfg: BroConfig
): Array<{ key: string; size: number; mtime: string }> {
  return getDb(cfg)
    .query(`SELECT key, size, mtime FROM objects ORDER BY key`)
    .all() as Array<{ key: string; size: number; mtime: string }>;
}

export function usedBytes(cfg: BroConfig): number {
  const row = getDb(cfg).query(`SELECT COALESCE(SUM(size), 0) AS s FROM objects`).get() as {
    s: number;
  };
  return Number(row.s || 0);
}

export function objectFilePath(cfg: BroConfig, key: string): string {
  const safe = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!safe || safe.includes('..')) throw new Error('Invalid object key');
  return path.join(objectsDir(cfg), safe);
}
