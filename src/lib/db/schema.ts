import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

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
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourcePath: text('source_path').notNull(),
  destinationPath: text('destination_path').notNull(),
  schedule: text('schedule').notNull(), // Cron expression
  excludePatterns: text('exclude_patterns'), // JSON string of patterns to exclude
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
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
});

// Relations
export const serversRelations = relations(servers, ({ one, many }) => ({
  backupConfigs: many(backupConfigs),
  sshKey: one(sshKeys, {
    fields: [servers.sshKeyId],
    references: [sshKeys.id],
  }),
}));

export const sshKeysRelations = relations(sshKeys, ({ many }) => ({
  servers: many(servers),
}));

export const backupConfigsRelations = relations(backupConfigs, ({ one, many }) => ({
  server: one(servers, {
    fields: [backupConfigs.serverId],
    references: [servers.id],
  }),
  backupHistory: many(backupHistory),
}));

export const backupHistoryRelations = relations(backupHistory, ({ one }) => ({
  backupConfig: one(backupConfigs, {
    fields: [backupHistory.configId],
    references: [backupConfigs.id],
  }),
})); 
