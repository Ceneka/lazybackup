import { findExactDestinationConflict } from '@/lib/backup/destination-guard'
import { backupConfigSchema } from '@/lib/backup/schema'
import { assertTransferServersHaveKeys } from '@/lib/backup/assert-transfer-keys'
import { restoreDatabaseBackup, restoreDockerVolumeBackup, restoreGitRepoBackup, restorePathBackup, executeBackup } from '@/lib/backup'
import {
  READ_ONLY_DENIED,
  REMOTE_EXEC_DENIED,
  assertCanRetargetPreBackupCommands,
  assertCanSetPreBackupCommands,
} from '@/lib/auth/permissions'
import { writeAuditLog, type AuditActor } from '@/lib/auth/audit'
import { attachLastValidation, validateBackupConfig } from '@/lib/backup/validate'
import { loadOperatorStatus } from '@/lib/status/load-status'
import { PeerRecallPendingError, peerRecallWaitingResponse } from '@/lib/peer/recall'
import { deliveryStateForHistoryRow } from '@/lib/peer/delivery-state'
import { publicPeerColumns } from '@/lib/api/history-query'
import { redactBackup, redactS3, redactServer } from '@/lib/api/redact'
import { db } from '@/lib/db'
import {
  backupConfigs,
  backupHistory,
  s3Profiles,
  servers,
  sshKeys,
} from '@/lib/db/schema'
import { scheduleBackup, stopBackup } from '@/lib/scheduler'
import { execRemoteCommand } from '@/lib/ssh/exec-remote'
import {
  serverInputSchema,
  validateServerCredentials,
  validateSshKeyMaterial,
} from '@/lib/ssh/key-validate'
import { and, desc, eq, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'

const backupWithEndpoints = {
  server: true,
  destinationServer: true,
  sourceS3Profile: true,
  destinationS3Profile: true,
  destinationPeer: true,
  sourceGitRepo: true,
} as const

const LOG_TRUNCATE = 4000

export function truncateLog(log: string | null | undefined, max = LOG_TRUNCATE): string | null {
  if (!log) return null
  if (log.length <= max) return log
  return `${log.slice(0, max)}\n…[truncated ${log.length - max} chars]`
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  }
}

async function audited<T>(
  actor: AuditActor | undefined,
  action: string,
  detail: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn()
    await writeAuditLog(actor, action, { detail, ok: true })
    return result
  } catch (error) {
    await writeAuditLog(actor, action, {
      detail: detail ? `${detail}: ${error instanceof Error ? error.message : 'error'}` : undefined,
      ok: false,
    })
    throw error
  }
}

function redactS3ForMcp<T extends Record<string, unknown>>(profile: T) {
  return redactS3(profile, { maskAccessKeyId: true })
}

function redactBackupForMcp(config: Record<string, unknown>) {
  const copy = attachLastValidation(redactBackup(config) as Record<string, unknown>)
  for (const key of ['sourceS3Profile', 'destinationS3Profile'] as const) {
    const profile = copy[key]
    if (profile && typeof profile === 'object') {
      const p = profile as Record<string, unknown>
      if (typeof p.accessKeyId === 'string' && p.accessKeyId.length > 0 && !String(p.accessKeyId).endsWith('…')) {
        p.accessKeyId = `${String(p.accessKeyId).slice(0, 4)}…`
      }
    }
  }
  return copy
}

export type McpOpsContext = {
  actor?: AuditActor
  /** Browser session / unlocked = true; Bearer only when token has remote_exec */
  canRemoteExec: boolean
  /** Session/unlocked always; Bearer false when token has read_only. */
  canWrite: boolean
  /** Auth audience. Bearer omits live DB passwords from get_container_db_hints. */
  via?: 'unlocked' | 'session' | 'bearer' | 'none'
}

function denyIfReadOnly(ctx: McpOpsContext) {
  if (ctx.canWrite === false) {
    return errorResult(READ_ONLY_DENIED)
  }
  return null
}

function assertMcpCanSetPreBackup(
  ctx: McpOpsContext,
  incoming: string | null | undefined,
  existing?: string | null
) {
  assertCanSetPreBackupCommands(
    {
      authorized: true,
      via: ctx.canRemoteExec ? 'session' : 'bearer',
      apiToken: ctx.canRemoteExec ? undefined : { permissions: [] },
    },
    incoming,
    existing
  )
}

function assertMcpCanRetargetPreBackup(
  ctx: McpOpsContext,
  incoming: string | null | undefined,
  existing: string | null | undefined,
  sourceEndpointChanged: boolean
) {
  assertCanRetargetPreBackupCommands(
    {
      authorized: true,
      via: ctx.canRemoteExec ? 'session' : 'bearer',
      apiToken: ctx.canRemoteExec ? undefined : { permissions: [] },
    },
    incoming,
    existing,
    sourceEndpointChanged
  )
}

export async function listBackupsOp(_ctx: McpOpsContext) {
  const configs = await db.query.backupConfigs.findMany({
    with: backupWithEndpoints,
  })
  return jsonResult(configs.map((c) => redactBackupForMcp(c as unknown as Record<string, unknown>)))
}

export async function getBackupOp(_ctx: McpOpsContext, id: string) {
  const config = await db.query.backupConfigs.findFirst({
    where: eq(backupConfigs.id, id),
    with: backupWithEndpoints,
  })
  if (!config) return errorResult(`Backup not found: ${id}`)
  return jsonResult(redactBackupForMcp(config as unknown as Record<string, unknown>))
}

export async function createBackupOp(ctx: McpOpsContext, input: unknown) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'create_backup', undefined, async () => {
    const validatedData = backupConfigSchema.parse(input)
    assertMcpCanSetPreBackup(ctx, validatedData.preBackupCommands)
    await assertTransferServersHaveKeys(validatedData)
    const conflictingBackup = await findExactDestinationConflict(
      validatedData.destinationPath,
      undefined,
      {
        destinationKind: validatedData.destinationKind,
        destinationServerId: validatedData.destinationServerId,
        destinationS3ProfileId: validatedData.destinationS3ProfileId,
        destinationPeerId: validatedData.destinationPeerId,
      }
    )
    if (conflictingBackup) {
      throw new Error(
        `Destination path is already used by backup "${conflictingBackup.name}"`
      )
    }

    const newConfig = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.insert(backupConfigs).values(newConfig)

    const completeConfig = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, newConfig.id),
      with: backupWithEndpoints,
    })
    if (completeConfig?.enabled) {
      await scheduleBackup(completeConfig)
    }
    return jsonResult({
      created: redactBackupForMcp(completeConfig as unknown as Record<string, unknown>),
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to create backup')
  )
}

export async function updateBackupOp(ctx: McpOpsContext, id: string, input: unknown) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'update_backup', id, async () => {
    const validatedData = backupConfigSchema.parse(input)
    const existing = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
    })
    if (!existing) throw new Error(`Backup not found: ${id}`)
    assertMcpCanSetPreBackup(ctx, validatedData.preBackupCommands, existing.preBackupCommands)
    const sourceEndpointChanged =
      (validatedData.sourceKind ?? 'server') !== (existing.sourceKind ?? 'server') ||
      (validatedData.serverId ?? null) !== (existing.serverId ?? null)
    assertMcpCanRetargetPreBackup(
      ctx,
      validatedData.preBackupCommands,
      existing.preBackupCommands,
      sourceEndpointChanged
    )
    await assertTransferServersHaveKeys(validatedData)

    const conflictingBackup = await findExactDestinationConflict(
      validatedData.destinationPath,
      id,
      {
        destinationKind: validatedData.destinationKind,
        destinationServerId: validatedData.destinationServerId,
        destinationS3ProfileId: validatedData.destinationS3ProfileId,
        destinationPeerId: validatedData.destinationPeerId,
      }
    )
    if (conflictingBackup) {
      throw new Error(
        `Destination path is already used by backup "${conflictingBackup.name}"`
      )
    }

    // GET redacts secrets, so a full-config update round-trips blank values.
    // Keep the stored one when blank; clear it when the source type stops using it.
    const dbPassword =
      validatedData.sourceType === 'database' && validatedData.dbEngine !== 'sqlite'
        ? validatedData.dbPassword && String(validatedData.dbPassword).trim()
          ? validatedData.dbPassword
          : existing.dbPassword ?? null
        : null
    const instanceBackupPassphrase =
      validatedData.sourceType === 'lazybackup_instance'
        ? validatedData.instanceBackupPassphrase &&
          String(validatedData.instanceBackupPassphrase).trim()
          ? validatedData.instanceBackupPassphrase
          : existing.instanceBackupPassphrase ?? null
        : null

    stopBackup(id)
    await db
      .update(backupConfigs)
      .set({
        ...validatedData,
        dbPassword,
        instanceBackupPassphrase,
        lastValidatedAt: null,
        lastValidationOk: null,
        lastValidationChecks: null,
        updatedAt: new Date(),
      })
      .where(eq(backupConfigs.id, id))

    const updated = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    })
    if (updated?.enabled) {
      await scheduleBackup(updated)
    }
    return jsonResult({
      updated: redactBackupForMcp(updated as unknown as Record<string, unknown>),
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to update backup')
  )
}

export async function deleteBackupOp(
  ctx: McpOpsContext,
  id: string,
  confirm: boolean
) {
  if (!confirm) {
    return errorResult('Refusing to delete: pass confirm=true to proceed')
  }
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'delete_backup', id, async () => {
    const existing = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
    })
    if (!existing) throw new Error(`Backup not found: ${id}`)
    stopBackup(id)
    await db.delete(backupConfigs).where(eq(backupConfigs.id, id))
    return jsonResult({ deleted: true, id, name: existing.name })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to delete backup')
  )
}

export async function runBackupOp(ctx: McpOpsContext, id: string) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'run_backup', id, async () => {
    const config = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    })
    if (!config) throw new Error(`Backup not found: ${id}`)

    const { assertCanStartBackup, withBackupStartLock } = await import(
      '@/lib/backup/concurrent-run'
    )
    const { createBackupHistoryEntry } = await import('@/lib/backup/history')
    const historyEntry = await withBackupStartLock(config.id, async () => {
      await assertCanStartBackup(config.id)
      return createBackupHistoryEntry(config.id, {
        backupName: config.name,
      })
    })
    executeBackup(config, historyEntry.id).catch((error) => {
      console.error(`Backup execution failed for ${config.name}:`, error)
    })
    return jsonResult({
      success: true,
      message: 'Backup started',
      historyId: historyEntry.id,
      backupName: config.name,
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to run backup')
  )
}

export async function toggleBackupOp(ctx: McpOpsContext, id: string, enabled?: boolean) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'toggle_backup', id, async () => {
    const current = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    })
    if (!current) throw new Error(`Backup not found: ${id}`)

    const newEnabled = typeof enabled === 'boolean' ? enabled : !current.enabled
    await db
      .update(backupConfigs)
      .set({ enabled: newEnabled, updatedAt: new Date() })
      .where(eq(backupConfigs.id, id))

    if (newEnabled) {
      await scheduleBackup({ ...current, enabled: true })
    } else {
      stopBackup(id)
    }

    const updated = await db.query.backupConfigs.findFirst({
      where: eq(backupConfigs.id, id),
      with: backupWithEndpoints,
    })
    return jsonResult(redactBackupForMcp(updated as unknown as Record<string, unknown>))
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to toggle backup')
  )
}

export async function listHistoryOp(
  _ctx: McpOpsContext,
  opts: { limit?: number; configId?: string; status?: string }
) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20))
  const conditions = []
  if (opts.configId) conditions.push(eq(backupHistory.configId, opts.configId))
  if (opts.status === 'running' || opts.status === 'success' || opts.status === 'failed') {
    conditions.push(eq(backupHistory.status, opts.status))
  }

  const rows = await db.query.backupHistory.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    with: {
      backupConfig: {
        columns: {
          id: true,
          name: true,
          sourceType: true,
          destinationKind: true,
          destinationPeerId: true,
        },
        with: {
          destinationPeer: { columns: publicPeerColumns },
        },
      },
    },
    orderBy: [desc(backupHistory.startTime)],
    limit,
  })

  return jsonResult(
    rows.map((row) => ({
      ...row,
      deliveryState: deliveryStateForHistoryRow(row),
      logOutput: truncateLog(row.logOutput),
    }))
  )
}

export async function getHistoryOp(_ctx: McpOpsContext, id: string) {
  const row = await db.query.backupHistory.findFirst({
    where: eq(backupHistory.id, id),
    with: {
      backupConfig: { with: backupWithEndpoints },
    },
  })
  if (!row) return errorResult(`History entry not found: ${id}`)
  return jsonResult({
    ...row,
    deliveryState: deliveryStateForHistoryRow(row),
    logOutput: truncateLog(row.logOutput),
    backupConfig: row.backupConfig
      ? redactBackupForMcp(row.backupConfig as unknown as Record<string, unknown>)
      : null,
  })
}

export async function restoreHistoryOp(
  ctx: McpOpsContext,
  id: string,
  confirm: boolean,
  opts: {
    volumeName?: string
    databaseName?: string
    targetPath?: string
    targetServerId?: string
  }
) {
  if (!confirm) {
    return errorResult('Refusing to restore: pass confirm=true to proceed')
  }
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'restore_history', id, async () => {
    const historyEntry = await db.query.backupHistory.findFirst({
      where: eq(backupHistory.id, id),
      with: { backupConfig: true },
    })
    if (!historyEntry) throw new Error(`History entry not found: ${id}`)

    // The run's frozen type wins: editing a config from path → database must
    // not route an old artifact into a different restore pipeline.
    const { parseRestoreSnapshot } = await import('@/lib/backup/restore-snapshot')
    const sourceType =
      parseRestoreSnapshot(historyEntry.configSnapshot)?.sourceType ||
      historyEntry.backupConfig?.sourceType ||
      'path'
    const allowRetarget = Boolean(
      opts.databaseName || opts.volumeName || opts.targetPath || opts.targetServerId
    )
    if (sourceType === 'database') {
      const result = await restoreDatabaseBackup(id, {
        databaseName: opts.databaseName,
        confirm: true,
        allowRetarget,
        targetServerId: opts.targetServerId,
      })
      return jsonResult({ success: true, database: result.database, log: truncateLog(result.log) })
    }
    if (sourceType === 'docker_volume') {
      const result = await restoreDockerVolumeBackup(id, {
        volumeName: opts.volumeName,
        confirm: true,
        allowRetarget,
        targetServerId: opts.targetServerId,
      })
      return jsonResult({
        success: true,
        volume: result.volumeName,
        log: truncateLog(result.log),
      })
    }
    if (sourceType === 'path') {
      const result = await restorePathBackup(id, {
        targetPath: opts.targetPath,
        confirm: true,
        allowRetarget,
        targetServerId: opts.targetServerId,
      })
      return jsonResult({
        success: true,
        targetPath: result.targetPath,
        log: truncateLog(result.log),
      })
    }
    if (sourceType === 'git_repo') {
      const result = await restoreGitRepoBackup(id, {
        targetPath: opts.targetPath,
        confirm: true,
        allowRetarget,
        targetServerId: opts.targetServerId,
      })
      return jsonResult({
        success: true,
        targetPath: result.targetPath,
        log: truncateLog(result.log),
      })
    }
    throw new Error('Only path, database, docker_volume, and git_repo backups can be restored via MCP')
  }).catch((error) => {
    if (error instanceof PeerRecallPendingError) {
      return jsonResult(peerRecallWaitingResponse(error.recallId))
    }
    return errorResult(error instanceof Error ? error.message : 'Failed to restore')
  })
}

export async function listServersOp(_ctx: McpOpsContext) {
  const all = await db.select().from(servers)
  return jsonResult(all.map((s) => redactServer(s as unknown as Record<string, unknown>)))
}

// Server payload: same shape/limits as the REST API (port bounds, credential rules).
const serverSchema = serverInputSchema

export async function createServerOp(ctx: McpOpsContext, input: unknown) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'create_server', undefined, async () => {
    const validated = serverSchema.parse(input)
    if (validated.authType === 'key' && validated.sshKeyId) {
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, validated.sshKeyId),
      })
      if (!key) throw new Error('Selected SSH key not found')
      const storedKeyCheck = await validateSshKeyMaterial(key)
      if (!storedKeyCheck.ok) {
        throw new Error(`Selected SSH key is unusable: ${storedKeyCheck.message}`)
      }
    }
    const credentialCheck = await validateServerCredentials(validated)
    if (!credentialCheck.ok) throw new Error(credentialCheck.message)
    const newServer = {
      id: nanoid(),
      ...validated,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.insert(servers).values(newServer)
    return jsonResult({
      created: redactServer(newServer as unknown as Record<string, unknown>),
      note: 'Password-only servers cannot execute transfers — attach an SSH key for backups.',
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to create server')
  )
}

export async function updateServerOp(ctx: McpOpsContext, id: string, input: unknown) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'update_server', id, async () => {
    const validated = serverSchema.parse(input)
    const existing = await db.query.servers.findFirst({ where: eq(servers.id, id) })
    if (!existing) throw new Error(`Server not found: ${id}`)

    // Blank secrets mean "keep the stored value"; explicit null clears.
    const password = validated.password?.trim() ? validated.password : existing.password
    const privateKey = validated.privateKey?.trim()
      ? validated.privateKey
      : existing.privateKey
    const sshKeyId =
      validated.sshKeyId !== undefined
        ? validated.sshKeyId?.trim() || null
        : existing.sshKeyId
    const systemKeyPath =
      validated.systemKeyPath !== undefined
        ? validated.systemKeyPath?.trim() || null
        : existing.systemKeyPath

    if (validated.authType === 'key' && sshKeyId) {
      const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, sshKeyId) })
      if (!key) throw new Error('Selected SSH key not found')
      const storedKeyCheck = await validateSshKeyMaterial(key)
      if (!storedKeyCheck.ok) {
        throw new Error(`Selected SSH key is unusable: ${storedKeyCheck.message}`)
      }
    }

    const credentialCheck = await validateServerCredentials({
      authType: validated.authType,
      password,
      privateKey,
      sshKeyId,
      systemKeyPath,
    })
    if (!credentialCheck.ok) throw new Error(credentialCheck.message)

    await db
      .update(servers)
      .set({ ...validated, password, privateKey, sshKeyId, systemKeyPath, updatedAt: new Date() })
      .where(eq(servers.id, id))
    const updated = await db.query.servers.findFirst({ where: eq(servers.id, id) })
    return jsonResult({
      updated: redactServer(updated as unknown as Record<string, unknown>),
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to update server')
  )
}

export async function deleteServerOp(
  ctx: McpOpsContext,
  id: string,
  confirm: boolean
) {
  if (!confirm) {
    return errorResult('Refusing to delete: pass confirm=true to proceed')
  }
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  return audited(ctx.actor, 'delete_server', id, async () => {
    const existing = await db.query.servers.findFirst({ where: eq(servers.id, id) })
    if (!existing) throw new Error(`Server not found: ${id}`)

    const referencing = await db.query.backupConfigs.findMany({
      where: or(eq(backupConfigs.serverId, id), eq(backupConfigs.destinationServerId, id)),
      columns: { id: true, name: true },
    })
    if (referencing.length > 0) {
      throw new Error(
        `Server is used by backups: ${referencing.map((b) => b.name).join(', ')}. Delete or reassign those first.`
      )
    }

    await db.delete(servers).where(eq(servers.id, id))
    return jsonResult({ deleted: true, id, name: existing.name })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to delete server')
  )
}

export async function listS3ProfilesOp(_ctx: McpOpsContext) {
  const profiles = await db.select().from(s3Profiles)
  return jsonResult(profiles.map((p) => redactS3ForMcp(p as unknown as Record<string, unknown>)))
}

export async function getDashboardOp(_ctx: McpOpsContext) {
  const allServers = await db.select({ id: servers.id }).from(servers)
  const allBackups = await db
    .select({ id: backupConfigs.id, enabled: backupConfigs.enabled })
    .from(backupConfigs)
  const allS3 = await db.select({ id: s3Profiles.id }).from(s3Profiles)
  const recent = await db.query.backupHistory.findMany({
    orderBy: [desc(backupHistory.startTime)],
    limit: 5,
    with: { backupConfig: { columns: { id: true, name: true } } },
  })

  return jsonResult({
    servers: allServers.length,
    s3Profiles: allS3.length,
    backups: allBackups.length,
    enabledBackups: allBackups.filter((b) => b.enabled).length,
    recentHistory: recent.map((r) => ({
      id: r.id,
      status: r.status,
      startTime: r.startTime,
      backupName: r.backupConfig?.name,
      errorMessage: r.errorMessage,
    })),
  })
}

/** Probe endpoints without transferring; allowed for read_only tokens. */
export async function validateBackupOp(_ctx: McpOpsContext, id: string) {
  const config = await db.query.backupConfigs.findFirst({
    where: eq(backupConfigs.id, id),
    with: backupWithEndpoints,
  })
  if (!config) return errorResult(`Backup not found: ${id}`)

  const result = await validateBackupConfig(config)
  const validatedAt = new Date()
  await db
    .update(backupConfigs)
    .set({
      lastValidatedAt: validatedAt,
      lastValidationOk: result.ok,
      lastValidationChecks: JSON.stringify(result.checks),
      updatedAt: validatedAt,
    })
    .where(eq(backupConfigs.id, id))

  return jsonResult({
    ...result,
    at: validatedAt.toISOString(),
  })
}

/** Operator safety posture; allowed for read_only tokens. */
export async function getStatusOp(_ctx: McpOpsContext) {
  const payload = await loadOperatorStatus()
  return jsonResult(payload)
}

/**
 * Direct SSH command on a configured server.
 * Requires remote_exec permission (Bearer) or a browser session.
 */
export async function execCommandOp(
  ctx: McpOpsContext,
  serverId: string,
  command: string,
  confirm: boolean,
  timeoutMs?: number
) {
  const denied = denyIfReadOnly(ctx)
  if (denied) return denied
  if (!ctx.canRemoteExec) {
    return errorResult(REMOTE_EXEC_DENIED)
  }
  if (!confirm) {
    return errorResult('Refusing to execute: pass confirm=true to proceed')
  }
  return audited(ctx.actor, 'exec_command', serverId, async () => {
    const result = await execRemoteCommand(serverId, command, { timeoutMs })
    return jsonResult(result)
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to execute command')
  )
}
