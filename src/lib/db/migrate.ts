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

    // File retention (dump destinations): age-based cleanup with min keep
    if (!backupColumns.includes('enable_file_retention')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN enable_file_retention INTEGER NOT NULL DEFAULT 0`);
    }

    if (!backupColumns.includes('retention_max_age')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN retention_max_age INTEGER DEFAULT 30`);
    }

    if (!backupColumns.includes('retention_max_age_unit')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN retention_max_age_unit TEXT DEFAULT 'days'`);
    }

    if (!backupColumns.includes('retention_min_keep')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN retention_min_keep INTEGER DEFAULT 5`);
    }

    if (!backupColumns.includes('source_type')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'path'`);
    }

    // From→To endpoints: nullable source server, destination server, kinds.
    // SQLite cannot drop NOT NULL on server_id via ALTER — rebuild the table once.
    const needsEndpointRebuild =
      !backupColumns.includes('source_kind') ||
      !backupColumns.includes('destination_kind') ||
      !backupColumns.includes('destination_server_id') ||
      backupConfigsInfo.rows.some(
        (row: any) => row.name === 'server_id' && row.notnull === 1
      );

    if (needsEndpointRebuild) {
      console.log('Migrating backup_configs for From→To endpoints...');
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE backup_configs_new (
          id text PRIMARY KEY NOT NULL,
          source_kind text NOT NULL DEFAULT 'server',
          server_id text,
          destination_kind text NOT NULL DEFAULT 'local',
          destination_server_id text,
          name text NOT NULL,
          source_type text NOT NULL DEFAULT 'path',
          source_path text NOT NULL,
          destination_path text NOT NULL,
          schedule text NOT NULL,
          exclude_patterns text,
          pre_backup_commands text,
          enabled integer DEFAULT true NOT NULL,
          enable_versioning integer NOT NULL DEFAULT 0,
          versions_to_keep integer DEFAULT 5,
          enable_file_retention integer NOT NULL DEFAULT 0,
          retention_max_age integer DEFAULT 30,
          retention_max_age_unit text DEFAULT 'days',
          retention_min_keep integer DEFAULT 5,
          created_at integer DEFAULT (unixepoch()) NOT NULL,
          updated_at integer DEFAULT (unixepoch()) NOT NULL,
          FOREIGN KEY (server_id) REFERENCES servers(id) ON UPDATE no action ON DELETE cascade,
          FOREIGN KEY (destination_server_id) REFERENCES servers(id) ON UPDATE no action ON DELETE cascade
        );
      `);

      // Read fresh columns in case earlier ALTERs just ran in this same migration pass
      const freshInfo = await db.run(sql`PRAGMA table_info(backup_configs)`);
      const cols = new Set(freshInfo.rows.map((row: any) => String(row.name)));

      const selectSourceType = cols.has('source_type') ? 'source_type' : `'path'`;
      const selectPreBackup = cols.has('pre_backup_commands') ? 'pre_backup_commands' : 'NULL';
      const selectVersioning = cols.has('enable_versioning') ? 'enable_versioning' : '0';
      const selectVersionsKeep = cols.has('versions_to_keep') ? 'versions_to_keep' : '5';
      const selectFileRetention = cols.has('enable_file_retention') ? 'enable_file_retention' : '0';
      const selectRetentionAge = cols.has('retention_max_age') ? 'retention_max_age' : '30';
      const selectRetentionUnit = cols.has('retention_max_age_unit') ? 'retention_max_age_unit' : `'days'`;
      const selectRetentionMin = cols.has('retention_min_keep') ? 'retention_min_keep' : '5';
      const selectSourceKind = cols.has('source_kind') ? 'source_kind' : `'server'`;
      const selectDestKind = cols.has('destination_kind') ? 'destination_kind' : `'local'`;
      const selectDestServer = cols.has('destination_server_id') ? 'destination_server_id' : 'NULL';

      await db.run(sql.raw(`
        INSERT INTO backup_configs_new (
          id, source_kind, server_id, destination_kind, destination_server_id,
          name, source_type, source_path, destination_path, schedule,
          exclude_patterns, pre_backup_commands, enabled,
          enable_versioning, versions_to_keep,
          enable_file_retention, retention_max_age, retention_max_age_unit, retention_min_keep,
          created_at, updated_at
        )
        SELECT
          id,
          COALESCE(${selectSourceKind}, 'server'),
          server_id,
          COALESCE(${selectDestKind}, 'local'),
          ${selectDestServer},
          name,
          COALESCE(${selectSourceType}, 'path'),
          source_path,
          destination_path,
          schedule,
          exclude_patterns,
          ${selectPreBackup},
          enabled,
          ${selectVersioning},
          ${selectVersionsKeep},
          ${selectFileRetention},
          ${selectRetentionAge},
          ${selectRetentionUnit},
          ${selectRetentionMin},
          created_at,
          updated_at
        FROM backup_configs;
      `));

      await db.run(sql`DROP TABLE backup_configs`);
      await db.run(sql`ALTER TABLE backup_configs_new RENAME TO backup_configs`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }

    // Database dump source columns (after any rebuild so they are not dropped)
    const backupConfigsAfter = await db.run(sql`PRAGMA table_info(backup_configs)`);
    const backupColsAfter = backupConfigsAfter.rows.map((row: any) => row.name);

    if (!backupColsAfter.includes('db_engine')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_engine TEXT`);
    }
    if (!backupColsAfter.includes('db_client')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_client TEXT`);
    }
    if (!backupColsAfter.includes('db_container')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_container TEXT`);
    }
    if (!backupColsAfter.includes('db_host')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_host TEXT`);
    }
    if (!backupColsAfter.includes('db_port')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_port INTEGER`);
    }
    if (!backupColsAfter.includes('db_user')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_user TEXT`);
    }
    if (!backupColsAfter.includes('db_password')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN db_password TEXT`);
    }

    const backupHistoryInfo = await db.run(sql`PRAGMA table_info(backup_history)`);
    const historyColumns = backupHistoryInfo.rows.map((row: any) => row.name);

    if (!historyColumns.includes('artifact_path')) {
      await db.run(sql`ALTER TABLE backup_history ADD COLUMN artifact_path TEXT`);
    }

    // S3-compatible profiles + backup_configs FKs
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS s3_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'us-east-1',
        bucket TEXT NOT NULL,
        access_key_id TEXT NOT NULL,
        secret_access_key TEXT NOT NULL,
        force_path_style INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    const backupConfigsS3 = await db.run(sql`PRAGMA table_info(backup_configs)`);
    const backupColsS3 = backupConfigsS3.rows.map((row: any) => row.name);

    if (!backupColsS3.includes('source_s3_profile_id')) {
      await db.run(
        sql`ALTER TABLE backup_configs ADD COLUMN source_s3_profile_id TEXT REFERENCES s3_profiles(id) ON DELETE CASCADE`
      );
    }
    if (!backupColsS3.includes('destination_s3_profile_id')) {
      await db.run(
        sql`ALTER TABLE backup_configs ADD COLUMN destination_s3_profile_id TEXT REFERENCES s3_profiles(id) ON DELETE CASCADE`
      );
    }

    const backupConfigsValidation = await db.run(sql`PRAGMA table_info(backup_configs)`);
    const backupColsValidation = backupConfigsValidation.rows.map((row: any) => row.name);
    if (!backupColsValidation.includes('last_validated_at')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN last_validated_at INTEGER`);
    }
    if (!backupColsValidation.includes('last_validation_ok')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN last_validation_ok INTEGER`);
    }
    if (!backupColsValidation.includes('last_validation_checks')) {
      await db.run(sql`ALTER TABLE backup_configs ADD COLUMN last_validation_checks TEXT`);
    }

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_used_at INTEGER,
        revoked_at INTEGER
      );
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY NOT NULL,
        token_id TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
        token_name TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        ok INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

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
