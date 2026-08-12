import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AuditActor } from '@/lib/auth/audit'
import * as discovery from './discovery'
import * as ops from './operations'

const BACKUP_GUIDE = `LazyBackup From→To: sourceKind/destinationKind are local|server|s3.
sourceType: path | docker_volume (server source only) | database (local or server) | lazybackup_instance (local only; packs SQLite + keys).
S3 sources only support sourceType=path. Destinations are paths or S3 prefixes.
lazybackup_instance cannot use Bro destinations; optional instanceBackupPassphrase wraps the archive.
SSH key required on every server endpoint used in a transfer.`

const DISCOVER_FIRST = `Never invent server names, volume names, container names, or IDs.
Always resolve with find_server / list_servers / list_docker_volumes / list_docker_containers first.
For database dumps prefer get_container_db_hints then test_database before create_backup.`

const REMOTE_EXEC_NOTE =
  'Requires API token remote_exec permission (or a browser session). Prefer this over setting preBackupCommands just to run a one-off command.'

function ctx(
  actor: AuditActor | undefined,
  canRemoteExec: boolean,
  via: ops.McpOpsContext['via']
): ops.McpOpsContext {
  return { actor, canRemoteExec, via }
}

export function registerLazyBackupTools(
  server: McpServer,
  options?: {
    actor?: AuditActor
    canRemoteExec?: boolean
    via?: ops.McpOpsContext['via']
  }
) {
  const actor = options?.actor
  const canRemoteExec = options?.canRemoteExec ?? false
  const via = options?.via ?? 'bearer'
  const c = ctx(actor, canRemoteExec, via)

  // --- Discovery & verify (call these before create_*) ---

  server.registerTool(
    'find_server',
    {
      title: 'Find server',
      description: `Fuzzy-match configured SSH servers by name, host, or id. ${DISCOVER_FIRST}`,
      inputSchema: z.object({
        query: z.string().describe('User phrase, e.g. "wordpress prod" or a hostname'),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
    async ({ query, limit }) => discovery.findServerOp(c, query, limit)
  )

  server.registerTool(
    'list_docker_volumes',
    {
      title: 'List Docker volumes',
      description:
        'List named Docker volumes on a server over SSH. Use exact names for sourceType=docker_volume. Never invent volume names.',
      inputSchema: z.object({
        serverId: z.string().describe('Server id from find_server or list_servers'),
      }),
    },
    async ({ serverId }) => discovery.listDockerVolumesOp(c, serverId)
  )

  server.registerTool(
    'list_docker_containers',
    {
      title: 'List Docker containers',
      description:
        'List running Docker containers on a server. Use exact names for dbClient=docker. Never invent container names.',
      inputSchema: z.object({
        serverId: z.string(),
      }),
    },
    async ({ serverId }) => discovery.listDockerContainersOp(c, serverId)
  )

  server.registerTool(
    'get_container_db_hints',
    {
      title: 'Container DB hints',
      description:
        'Inspect a container and infer Postgres/MySQL/MariaDB engine, user, password, database from env. Call after list_docker_containers.',
      inputSchema: z.object({
        serverId: z.string(),
        container: z.string().describe('Exact container name'),
      }),
    },
    async ({ serverId, container }) =>
      discovery.getContainerDbHintsOp(c, serverId, container)
  )

  server.registerTool(
    'test_server',
    {
      title: 'Test server',
      description:
        'SSH connectivity + rsync/scp (and related) capability check for a server. Call before relying on transfers.',
      inputSchema: z.object({
        serverId: z.string(),
      }),
    },
    async ({ serverId }) => discovery.testServerOp(c, serverId)
  )

  server.registerTool(
    'test_database',
    {
      title: 'Test database connection',
      description:
        'Run SELECT 1 via native client or docker exec without saving a backup. Call after get_container_db_hints and before create_backup for database sources.',
      inputSchema: z.object({
        sourceKind: z.enum(['local', 'server']).default('server'),
        serverId: z.string().optional(),
        dbEngine: z.enum(['postgres', 'mysql', 'mariadb']),
        dbClient: z.enum(['native', 'docker']),
        dbContainer: z.string().optional(),
        dbHost: z.string().optional(),
        dbPort: z.number().int().optional(),
        dbUser: z.string(),
        dbPassword: z.string().optional(),
        sourcePath: z.string().describe('Database name'),
      }),
    },
    async (args) => discovery.testDatabaseOp(c, args)
  )

  server.registerTool(
    'exec_command',
    {
      title: 'Execute remote command',
      description: `Run a shell command over SSH on a configured server. ${REMOTE_EXEC_NOTE} Requires confirm=true. Output may be truncated.`,
      inputSchema: z.object({
        serverId: z.string().describe('Server id from find_server or list_servers'),
        command: z.string().min(1).describe('Shell command to run on the remote host'),
        confirm: z.boolean().describe('Must be true to execute'),
        timeoutMs: z
          .number()
          .int()
          .min(1000)
          .max(300_000)
          .optional()
          .describe('Optional timeout in ms (default 120000)'),
      }),
    },
    async ({ serverId, command, confirm, timeoutMs }) =>
      ops.execCommandOp(c, serverId, command, confirm, timeoutMs)
  )

  // --- Backups ---

  server.registerTool(
    'list_backups',
    {
      title: 'List backups',
      description: `List all backup configurations with endpoints. ${BACKUP_GUIDE}`,
      inputSchema: z.object({}),
    },
    async () => ops.listBackupsOp(c)
  )

  server.registerTool(
    'get_backup',
    {
      title: 'Get backup',
      description: 'Get one backup configuration by id.',
      inputSchema: z.object({
        id: z.string().describe('Backup config id'),
      }),
    },
    async ({ id }) => ops.getBackupOp(c, id)
  )

  server.registerTool(
    'create_backup',
    {
      title: 'Create backup',
      description: `Create a backup configuration. ${BACKUP_GUIDE}
${DISCOVER_FIRST}
Required: name, sourceKind, destinationKind, sourceType, sourcePath, destinationPath, schedule (5-field cron).
When sourceKind=server set serverId from find_server; for docker_volume use list_docker_volumes; for database use get_container_db_hints + test_database.
Setting or changing preBackupCommands requires remote_exec (prefer exec_command for one-off shell).`,
      inputSchema: z.object({
        config: z
          .record(z.string(), z.unknown())
          .describe('Backup config object matching the LazyBackup API schema'),
      }),
    },
    async ({ config }) => ops.createBackupOp(c, config)
  )

  server.registerTool(
    'update_backup',
    {
      title: 'Update backup',
      description: `Replace a backup configuration by id with a full config object. ${BACKUP_GUIDE} ${DISCOVER_FIRST}
Setting or changing preBackupCommands requires remote_exec.`,
      inputSchema: z.object({
        id: z.string(),
        config: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ id, config }) => ops.updateBackupOp(c, id, config)
  )

  server.registerTool(
    'delete_backup',
    {
      title: 'Delete backup',
      description: 'Delete a backup configuration. Requires confirm=true.',
      inputSchema: z.object({
        id: z.string(),
        confirm: z.boolean().describe('Must be true to delete'),
      }),
    },
    async ({ id, confirm }) => ops.deleteBackupOp(c, id, confirm)
  )

  server.registerTool(
    'run_backup',
    {
      title: 'Run backup',
      description: 'Start a backup run immediately. Returns historyId.',
      inputSchema: z.object({
        id: z.string().describe('Backup config id'),
      }),
    },
    async ({ id }) => ops.runBackupOp(c, id)
  )

  server.registerTool(
    'toggle_backup',
    {
      title: 'Toggle backup',
      description: 'Enable or disable a backup schedule. Omit enabled to flip.',
      inputSchema: z.object({
        id: z.string(),
        enabled: z.boolean().optional(),
      }),
    },
    async ({ id, enabled }) => ops.toggleBackupOp(c, id, enabled)
  )

  server.registerTool(
    'list_history',
    {
      title: 'List history',
      description: 'List recent backup history entries (log output truncated).',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
        configId: z.string().optional(),
        status: z.enum(['running', 'success', 'failed']).optional(),
      }),
    },
    async (args) => ops.listHistoryOp(c, args)
  )

  server.registerTool(
    'get_history',
    {
      title: 'Get history',
      description: 'Get one history entry (log truncated).',
      inputSchema: z.object({
        id: z.string(),
      }),
    },
    async ({ id }) => ops.getHistoryOp(c, id)
  )

  server.registerTool(
    'restore_history',
    {
      title: 'Restore history',
      description:
        'Restore a successful path, database, or docker_volume backup. Requires confirm=true. Optional targetPath, volumeName, or databaseName overrides.',
      inputSchema: z.object({
        id: z.string().describe('History entry id'),
        confirm: z.boolean(),
        targetPath: z.string().optional(),
        volumeName: z.string().optional(),
        databaseName: z.string().optional(),
      }),
    },
    async ({ id, confirm, targetPath, volumeName, databaseName }) =>
      ops.restoreHistoryOp(c, id, confirm, { targetPath, volumeName, databaseName })
  )

  server.registerTool(
    'list_servers',
    {
      title: 'List servers',
      description: `List SSH servers (secrets redacted). Prefer find_server for a user phrase. ${DISCOVER_FIRST}`,
      inputSchema: z.object({}),
    },
    async () => ops.listServersOp(c)
  )

  server.registerTool(
    'create_server',
    {
      title: 'Create server',
      description:
        'Create an SSH server. Transfers require key auth (privateKey, sshKeyId, or systemKeyPath). Call test_server after create.',
      inputSchema: z.object({
        name: z.string(),
        host: z.string(),
        port: z.number().int().optional(),
        username: z.string(),
        authType: z.enum(['password', 'key']),
        password: z.string().optional(),
        privateKey: z.string().optional(),
        sshKeyId: z.string().optional(),
        systemKeyPath: z.string().optional(),
      }),
    },
    async (args) => ops.createServerOp(c, args)
  )

  server.registerTool(
    'update_server',
    {
      title: 'Update server',
      description: 'Update an SSH server by id.',
      inputSchema: z.object({
        id: z.string(),
        name: z.string(),
        host: z.string(),
        port: z.number().int().optional(),
        username: z.string(),
        authType: z.enum(['password', 'key']),
        password: z.string().optional(),
        privateKey: z.string().optional(),
        sshKeyId: z.string().optional(),
        systemKeyPath: z.string().optional(),
      }),
    },
    async ({ id, ...rest }) => ops.updateServerOp(c, id, rest)
  )

  server.registerTool(
    'delete_server',
    {
      title: 'Delete server',
      description: 'Delete a server. Requires confirm=true. Fails if backups still reference it.',
      inputSchema: z.object({
        id: z.string(),
        confirm: z.boolean(),
      }),
    },
    async ({ id, confirm }) => ops.deleteServerOp(c, id, confirm)
  )

  server.registerTool(
    'list_s3_profiles',
    {
      title: 'List S3 profiles',
      description: 'List S3-compatible storage profiles (secrets redacted). Never invent profile ids.',
      inputSchema: z.object({}),
    },
    async () => ops.listS3ProfilesOp(c)
  )

  server.registerTool(
    'get_dashboard',
    {
      title: 'Dashboard summary',
      description: 'Counts of servers/backups and recent history.',
      inputSchema: z.object({}),
    },
    async () => ops.getDashboardOp(c)
  )

  server.registerResource(
    'backups',
    'lazybackup://backups',
    {
      title: 'Backups',
      description: 'Current backup configurations (JSON)',
      mimeType: 'application/json',
    },
    async () => {
      const result = await ops.listBackupsOp(c)
      return {
        contents: [
          {
            uri: 'lazybackup://backups',
            mimeType: 'application/json',
            text: result.content[0]?.text ?? '[]',
          },
        ],
      }
    }
  )

  server.registerResource(
    'recent-history',
    'lazybackup://history/recent',
    {
      title: 'Recent history',
      description: 'Recent backup history (JSON)',
      mimeType: 'application/json',
    },
    async () => {
      const result = await ops.listHistoryOp(c, { limit: 20 })
      return {
        contents: [
          {
            uri: 'lazybackup://history/recent',
            mimeType: 'application/json',
            text: result.content[0]?.text ?? '[]',
          },
        ],
      }
    }
  )
}
