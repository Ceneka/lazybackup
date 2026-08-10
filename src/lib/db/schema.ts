import { relations, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Application settings
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().notNull(),
  key: text('key').notNull().unique(),
  value: text('value'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// SSH Keys
export const sshKeys = sqliteTable('ssh_keys', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  privateKeyPath: text('private_key_path'),
  publicKeyPath: text('public_key_path'),
  privateKeyContent: text('private_key_content'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Servers table (VPS connections)
export const servers = sqliteTable('servers', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(22),
  username: text('username').notNull(),
  authType: text('auth_type', { enum: ['password', 'key'] }).notNull(),
  password: text('password'),
  privateKey: text('private_key'),
  sshKeyId: text('ssh_key_id').references(() => sshKeys.id, { onDelete: 'set null' }),
  systemKeyPath: text('system_key_path'), // Direct reference to a system SSH key path
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Backup configurations
export const backupConfigs = sqliteTable('backup_configs', {
  id: text('id').primaryKey().notNull(),
  /** Where data is copied from: LazyBackup host or an SSH server */
  sourceKind: text('source_kind', { enum: ['local', 'server'] }).notNull().default('server'),
  /** Source server when sourceKind === 'server' */
  serverId: text('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  /** Where data is copied to */
  destinationKind: text('destination_kind', { enum: ['local', 'server'] }).notNull().default('local'),
  /** Destination server when destinationKind === 'server' */
  destinationServerId: text('destination_server_id').references(() => servers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** 'path' = filesystem path; 'docker_volume' = named Docker volume on source server only */
  sourceType: text('source_type', { enum: ['path', 'docker_volume'] }).notNull().default('path'),
  sourcePath: text('source_path').notNull(),
  destinationPath: text('destination_path').notNull(),
  schedule: text('schedule').notNull(), // Cron expression
  excludePatterns: text('exclude_patterns'), // JSON string of patterns to exclude
  preBackupCommands: text('pre_backup_commands'), // Commands to run before backup starts
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  enableVersioning: integer('enable_versioning', { mode: 'boolean' }).notNull().default(false),
  versionsToKeep: integer('versions_to_keep').default(5),
  enableFileRetention: integer('enable_file_retention', { mode: 'boolean' }).notNull().default(false),
  retentionMaxAge: integer('retention_max_age').default(30),
  retentionMaxAgeUnit: text('retention_max_age_unit', { enum: ['days', 'months'] }).default('days'),
  retentionMinKeep: integer('retention_min_keep').default(5),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Backup history
export const backupHistory = sqliteTable('backup_history', {
  id: text('id').primaryKey().notNull(),
  configId: text('config_id').notNull().references(() => backupConfigs.id, { onDelete: 'cascade' }),
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp' }),
  status: text('status', { enum: ['running', 'success', 'failed'] }).notNull(),
  fileCount: integer('file_count'),
  totalSize: integer('total_size'), // In bytes
  transferredSize: integer('transferred_size'), // In bytes
  errorMessage: text('error_message'),
  logOutput: text('log_output'),
  /** Local path to the backup artifact (.tar.gz for docker volumes, directory for path backups) */
  artifactPath: text('artifact_path'),
});

// Relations
export const serversRelations = relations(servers, ({ one, many }) => ({
  backupConfigs: many(backupConfigs, { relationName: 'backupSourceServer' }),
  destinationBackupConfigs: many(backupConfigs, { relationName: 'backupDestinationServer' }),
  sshKey: one(sshKeys, {
    fields: [servers.sshKeyId],
    references: [sshKeys.id],
  }),
}));

export const sshKeysRelations = relations(sshKeys, ({ many }) => ({
  servers: many(servers),
}));

export const backupConfigsRelations = relations(backupConfigs, ({ one, many }) => ({
  /** Source server when sourceKind === 'server' */
  server: one(servers, {
    fields: [backupConfigs.serverId],
    references: [servers.id],
    relationName: 'backupSourceServer',
  }),
  destinationServer: one(servers, {
    fields: [backupConfigs.destinationServerId],
    references: [servers.id],
    relationName: 'backupDestinationServer',
  }),
  backupHistory: many(backupHistory),
}));

export const backupHistoryRelations = relations(backupHistory, ({ one }) => ({
  backupConfig: one(backupConfigs, {
    fields: [backupHistory.configId],
    references: [backupConfigs.id],
  }),
})); 
