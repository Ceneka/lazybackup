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

/** S3-compatible storage profiles (MinIO, R2, B2, AWS, …) */
export const s3Profiles = sqliteTable('s3_profiles', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('us-east-1'),
  bucket: text('bucket').notNull(),
  accessKeyId: text('access_key_id').notNull(),
  secretAccessKey: text('secret_access_key').notNull(),
  forcePathStyle: integer('force_path_style', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Backup configurations
export const backupConfigs = sqliteTable('backup_configs', {
  id: text('id').primaryKey().notNull(),
  /** Where data is copied from: LazyBackup host, SSH server, or S3 */
  sourceKind: text('source_kind', { enum: ['local', 'server', 's3'] }).notNull().default('server'),
  /** Source server when sourceKind === 'server' */
  serverId: text('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  /** Source S3 profile when sourceKind === 's3' */
  sourceS3ProfileId: text('source_s3_profile_id').references(() => s3Profiles.id, {
    onDelete: 'cascade',
  }),
  /** Where data is copied to */
  destinationKind: text('destination_kind', { enum: ['local', 'server', 's3', 'peer'] })
    .notNull()
    .default('local'),
  /** Destination server when destinationKind === 'server' */
  destinationServerId: text('destination_server_id').references(() => servers.id, {
    onDelete: 'cascade',
  }),
  /** Destination S3 profile when destinationKind === 's3' */
  destinationS3ProfileId: text('destination_s3_profile_id').references(() => s3Profiles.id, {
    onDelete: 'cascade',
  }),
  /** Destination bro peer when destinationKind === 'peer' */
  destinationPeerId: text('destination_peer_id'),
  name: text('name').notNull(),
  /**
   * 'path' | 'docker_volume' (server or local Docker) | 'database' (local or server; sourcePath = DB name)
   * | 'lazybackup_instance' (local only; packs SQLite + keys)
   */
  sourceType: text('source_type', {
    enum: ['path', 'docker_volume', 'database', 'lazybackup_instance'],
  })
    .notNull()
    .default('path'),
  sourcePath: text('source_path').notNull(),
  destinationPath: text('destination_path').notNull(),
  schedule: text('schedule').notNull(), // Cron expression
  excludePatterns: text('exclude_patterns'), // JSON string of patterns to exclude
  preBackupCommands: text('pre_backup_commands'), // Commands to run before backup starts
  /** Database dump settings when sourceType === 'database' */
  dbEngine: text('db_engine', { enum: ['postgres', 'mysql', 'mariadb', 'sqlite'] }),
  dbClient: text('db_client', { enum: ['native', 'docker'] }),
  dbContainer: text('db_container'),
  dbHost: text('db_host'),
  dbPort: integer('db_port'),
  dbUser: text('db_user'),
  dbPassword: text('db_password'),
  /**
   * Optional age passphrase wrap for lazybackup_instance archives
   * (not the instance age key — avoids circular encrypt).
   */
  instanceBackupPassphrase: text('instance_backup_passphrase'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Client-side age encryption before land (forced on for peer destinations) */
  enableEncryption: integer('enable_encryption', { mode: 'boolean' }).notNull().default(false),
  enableVersioning: integer('enable_versioning', { mode: 'boolean' }).notNull().default(false),
  versionsToKeep: integer('versions_to_keep').default(5),
  enableFileRetention: integer('enable_file_retention', { mode: 'boolean' }).notNull().default(false),
  retentionMaxAge: integer('retention_max_age').default(30),
  retentionMaxAgeUnit: text('retention_max_age_unit', { enum: ['days', 'months'] }).default('days'),
  retentionMinKeep: integer('retention_min_keep').default(5),
  /** Last POST /validate result (cleared when config is updated) */
  lastValidatedAt: integer('last_validated_at', { mode: 'timestamp' }),
  lastValidationOk: integer('last_validation_ok', { mode: 'boolean' }),
  /** JSON array of ValidateCheck */
  lastValidationChecks: text('last_validation_checks'),
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
  /** Local/remote/S3 path to artifact (.tar.gz / .sql.gz for volume|database, directory for path) */
  artifactPath: text('artifact_path'),
  /**
   * SHA-256 hex of the landed ciphertext (age blob, archive, or dump).
   * Used to detect peer store substitution on restore/recall.
   */
  artifactSha256: text('artifact_sha256'),
  /**
   * Bro mailbox: artifact is staged locally and waiting for a verified ACK.
   * status stays `success` so existing UI/filters keep working.
   */
  mailboxPending: integer('mailbox_pending', { mode: 'boolean' }).notNull().default(false),
  /**
   * Bro retention: object was deleted on the peer after a verified delete ACK.
   * Restore must fail clearly instead of hanging on recall.
   */
  artifactRemoved: integer('artifact_removed', { mode: 'boolean' }).notNull().default(false),
});

/** Machine API tokens for MCP / Bearer auth (hash only; plaintext shown once) */
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  /** SHA-256 hash of the full token */
  tokenHash: text('token_hash').notNull(),
  /** First characters for UI display, e.g. lb_xxxx… */
  tokenPrefix: text('token_prefix').notNull(),
  /** JSON array of ApiTokenPermission, e.g. ["remote_exec"] or ["read_only"] */
  permissions: text('permissions').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

/** Audit trail for Bearer / MCP actions (no secrets) */
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey().notNull(),
  /** api token id when Bearer-authenticated; null for session or unknown */
  tokenId: text('token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
  tokenName: text('token_name'),
  action: text('action').notNull(),
  detail: text('detail'),
  ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/**
 * Paired LazyBackup instances for bro↔bro storage (1:1 reciprocal quota).
 * Each side stores a row for the other peer.
 */
export const peers = sqliteTable('peers', {
  id: text('id').primaryKey().notNull(),
  /** Display name (bro's chosen label or hostname) */
  name: text('name').notNull(),
  /**
   * Base URL of the remote mailbox host (https://… or http://…).
   * Empty for LazyBro clients (outbound-only; we never dial them).
   */
  remoteBaseUrl: text('remote_base_url').notNull().default(''),
  /** Peer id on the remote instance */
  remotePeerId: text('remote_peer_id'),
  /** Bearer token we present when calling the remote (plaintext; treat as secret) */
  outboundToken: text('outbound_token'),
  /** SHA-256 hash of the token the remote presents when calling us */
  inboundTokenHash: text('inbound_token_hash').notNull(),
  /** First chars of inbound token for UI */
  inboundTokenPrefix: text('inbound_token_prefix').notNull(),
  /** Agreed 1:1 quota in bytes (same on both sides) */
  quotaBytes: integer('quota_bytes').notNull(),
  /** Bytes currently stored by the remote peer on this host */
  usedBytes: integer('used_bytes').notNull().default(0),
  /**
   * mailbox = stage locally + peer pulls (default for new pairs).
   * direct = legacy live PUT to remote /api/peers/store.
   */
  transport: text('transport', { enum: ['mailbox', 'direct'] })
    .notNull()
    .default('mailbox'),
  status: text('status', { enum: ['pending', 'active', 'revoked'] })
    .notNull()
    .default('pending'),
  /** Last successful agent ping/work from this peer (soft presence) */
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/**
 * Recall requests: ask a peer holding an object to upload it back (mailbox restore).
 */
export const peerRecalls = sqliteTable('peer_recalls', {
  id: text('id').primaryKey().notNull(),
  peerId: text('peer_id')
    .notNull()
    .references(() => peers.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  historyId: text('history_id'),
  status: text('status', {
    enum: ['pending', 'uploading', 'ready', 'consumed', 'failed', 'expired'],
  })
    .notNull()
    .default('pending'),
  error: text('error'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  readyAt: integer('ready_at', { mode: 'timestamp' }),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
});

/**
 * Mailbox retention deletes: host decides keys, Bro unlinks, host forgets after ACK.
 */
export const peerDeletes = sqliteTable('peer_deletes', {
  id: text('id').primaryKey().notNull(),
  peerId: text('peer_id')
    .notNull()
    .references(() => peers.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  status: text('status', { enum: ['pending', 'acked'] })
    .notNull()
    .default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  ackedAt: integer('acked_at', { mode: 'timestamp' }),
});

/** Age encryption key vault (multiple identities; one active for new encrypts) */
export const ageKeys = sqliteTable('age_keys', {
  id: text('id').primaryKey().notNull(),
  label: text('label').notNull(),
  /** AGE-SECRET-KEY-1… */
  identity: text('identity').notNull(),
  /** age1… public recipient */
  recipient: text('recipient').notNull(),
  status: text('status', { enum: ['active', 'retired', 'compromised'] })
    .notNull()
    .default('active'),
  /** Operator acknowledged offline export */
  exportAcknowledgedAt: integer('export_acknowledged_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/** Extra public recipients included on every encrypt (offline recovery keys) */
export const ageRecoveryRecipients = sqliteTable('age_recovery_recipients', {
  id: text('id').primaryKey().notNull(),
  label: text('label').notNull(),
  recipient: text('recipient').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/** WebAuthn / passkey credentials for app login */
export const webauthnCredentials = sqliteTable('webauthn_credentials', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  /** Base64URL credential id */
  credentialId: text('credential_id').notNull().unique(),
  /** Base64URL public key */
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  /** JSON array of AuthenticatorTransport */
  transports: text('transports').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
});

/** Outbound pairing invites (one-time) */
export const peerInvites = sqliteTable('peer_invites', {
  id: text('id').primaryKey().notNull(),
  /** Short human-shareable code */
  code: text('code').notNull().unique(),
  /** SHA-256 of invite secret */
  secretHash: text('secret_hash').notNull(),
  quotaBytes: integer('quota_bytes').notNull(),
  /** Our public base URL embedded in the invite for the bro */
  localBaseUrl: text('local_base_url').notNull(),
  /** Display name we want the bro to see */
  label: text('label').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'cancelled', 'expired'] })
    .notNull()
    .default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  peerId: text('peer_id').references(() => peers.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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

export const s3ProfilesRelations = relations(s3Profiles, ({ many }) => ({
  sourceBackupConfigs: many(backupConfigs, { relationName: 'backupSourceS3' }),
  destinationBackupConfigs: many(backupConfigs, { relationName: 'backupDestinationS3' }),
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
  sourceS3Profile: one(s3Profiles, {
    fields: [backupConfigs.sourceS3ProfileId],
    references: [s3Profiles.id],
    relationName: 'backupSourceS3',
  }),
  destinationS3Profile: one(s3Profiles, {
    fields: [backupConfigs.destinationS3ProfileId],
    references: [s3Profiles.id],
    relationName: 'backupDestinationS3',
  }),
  destinationPeer: one(peers, {
    fields: [backupConfigs.destinationPeerId],
    references: [peers.id],
    relationName: 'backupDestinationPeer',
  }),
  backupHistory: many(backupHistory),
}));

export const peersRelations = relations(peers, ({ many }) => ({
  destinationBackupConfigs: many(backupConfigs, { relationName: 'backupDestinationPeer' }),
  recalls: many(peerRecalls),
  deletes: many(peerDeletes),
}));

export const peerDeletesRelations = relations(peerDeletes, ({ one }) => ({
  peer: one(peers, {
    fields: [peerDeletes.peerId],
    references: [peers.id],
  }),
}));

export const peerRecallsRelations = relations(peerRecalls, ({ one }) => ({
  peer: one(peers, {
    fields: [peerRecalls.peerId],
    references: [peers.id],
  }),
}));

export const backupHistoryRelations = relations(backupHistory, ({ one }) => ({
  backupConfig: one(backupConfigs, {
    fields: [backupHistory.configId],
    references: [backupConfigs.id],
  }),
}));
