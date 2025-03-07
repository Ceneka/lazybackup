import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

// Run migration
export async function runMigration() {
  console.log('Running database migrations...');

  try {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS backup_configs (
        id text PRIMARY KEY NOT NULL,
        server_id text NOT NULL,
        name text NOT NULL,
        source_path text NOT NULL,
        destination_path text NOT NULL,
        schedule text NOT NULL,
        exclude_patterns text,
        pre_backup_commands text,
        enabled integer DEFAULT true NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON UPDATE no action ON DELETE cascade
      );
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS backup_history (
        id text PRIMARY KEY NOT NULL,
        config_id text NOT NULL,
        start_time integer NOT NULL,
        end_time integer,
        status text NOT NULL,
        file_count integer,
        total_size integer,
        transferred_size integer,
        error_message text,
        log_output text,
        FOREIGN KEY (config_id) REFERENCES backup_configs(id) ON UPDATE no action ON DELETE cascade
      );
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS servers (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        host text NOT NULL,
        port integer DEFAULT 22 NOT NULL,
        username text NOT NULL,
        auth_type text NOT NULL,
        password text,
        private_key text,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      );
    `);

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

    // Check and add versioning columns to backup_configs table
    const backupConfigsInfo = await db.run(sql`PRAGMA table_info(backup_configs)`);
    const backupColumns = backupConfigsInfo.rows.map((row: any) => row.name);

    if (!backupColumns.includes('enable_versioning')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN enable_versioning INTEGER NOT NULL DEFAULT 0`);
    }

    if (!backupColumns.includes('versions_to_keep')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN versions_to_keep INTEGER DEFAULT 5`);
    }

    // Check and add pre_backup_commands column to backup_configs table
    if (!backupColumns.includes('pre_backup_commands')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN pre_backup_commands TEXT`);
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
