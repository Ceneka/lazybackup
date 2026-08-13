import fs from 'fs/promises';
import path from 'path';
import { Database } from 'bun:sqlite';
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

export function closeDb(): void {
  db?.close();
  db = null;
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

export function removeObject(cfg: BroConfig, key: string): void {
  getDb(cfg).query(`DELETE FROM objects WHERE key = ?`).run(key);
}

export function getObject(
  cfg: BroConfig,
  key: string
): { key: string; size: number; mtime: string } | null {
  const row = getDb(cfg)
    .query(`SELECT key, size, mtime FROM objects WHERE key = ?`)
    .get(key) as { key: string; size: number; mtime: string } | null;
  return row ?? null;
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
  const root = path.resolve(objectsDir(cfg));
  const dest = path.resolve(root, safe);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error('Invalid object key');
  }
  return dest;
}

export async function unlinkObject(cfg: BroConfig, key: string): Promise<void> {
  const dest = objectFilePath(cfg, key);
  await fs.unlink(dest).catch(() => {});
  removeObject(cfg, key);
}
