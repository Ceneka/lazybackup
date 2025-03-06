import { db } from '@/lib/db';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { settings, sshKeys, servers } from './schema';
import { sql } from 'drizzle-orm';

// Run migration
export async function runMigration() {
  console.log('Running database migrations...');
  
  try {
    // Add SSH Keys table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS ssh_keys (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        private_key_path TEXT,
        public_key_path TEXT,
        private_key_content TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    
    // Add Settings table
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY NOT NULL,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    
    // Check and add ssh_key_id column to servers table
    const tableInfo = await db.run(sql`PRAGMA table_info(servers)`);
    const columns = tableInfo.rows.map((row: any) => row.name);
    
    if (!columns.includes('ssh_key_id')) {
      await db.run(sql`ALTER TABLE servers ADD COLUMN ssh_key_id TEXT REFERENCES ssh_keys(id) ON DELETE SET NULL`);
    }
    
    // Check and add system_key_path column to servers table
    if (!columns.includes('system_key_path')) {
      await db.run(sql`ALTER TABLE servers ADD COLUMN system_key_path TEXT`);
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
} 
