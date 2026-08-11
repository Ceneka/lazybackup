import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AuditActor } from '@/lib/auth/audit'
import * as ops from './operations'

const BACKUP_GUIDE = `LazyBackup From→To: sourceKind/destinationKind are local|server|s3.
sourceType: path | docker_volume (server source only) | database (local or server).
S3 sources only support sourceType=path. Destinations are paths or S3 prefixes.
SSH key required on every server endpoint used in a transfer.`

function ctx(actor?: AuditActor): ops.McpOpsContext {
  return { actor }
}

export function registerLazyBackupTools(server: McpServer, actor?: AuditActor) {
  const c = ctx(actor)

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
Required fields typically: name, sourceKind, destinationKind, sourceType, sourcePath, destinationPath, schedule (5-field cron).
When sourceKind=server set serverId; when destinationKind=server set destinationServerId; for S3 set the matching *S3ProfileId.`,
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
      description: `Replace a backup configuration by id with a full config object. ${BACKUP_GUIDE}`,
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
        'Restore a successful database or docker_volume backup. Requires confirm=true. Optional volumeName or databaseName overrides.',
      inputSchema: z.object({
        id: z.string().describe('History entry id'),
        confirm: z.boolean(),
        volumeName: z.string().optional(),
        databaseName: z.string().optional(),
      }),
    },
    async ({ id, confirm, volumeName, databaseName }) =>
      ops.restoreHistoryOp(c, id, confirm, { volumeName, databaseName })
  )

  server.registerTool(
    'list_servers',
    {
      title: 'List servers',
      description: 'List SSH servers (secrets redacted).',
      inputSchema: z.object({}),
    },
    async () => ops.listServersOp(c)
  )

  server.registerTool(
    'create_server',
    {
      title: 'Create server',
      description:
        'Create an SSH server. Transfers require key auth (privateKey, sshKeyId, or systemKeyPath).',
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
      description: 'List S3-compatible storage profiles (secrets redacted).',
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
