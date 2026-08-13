import { listApiTokens, sessionCookieSecure } from '@/lib/auth'
import { getPasswordHash } from '@/lib/auth/settings'
import { countPasskeys } from '@/lib/auth/webauthn'
import { getEncryptionKeyStatus } from '@/lib/crypto/keys'
import { isScheduleOverdue } from '@/lib/cron/overdue'
import { db } from '@/lib/db'
import { backupHistory, settings } from '@/lib/db/schema'
import { FAILURE_WEBHOOK_URL_KEY } from '@/lib/notify/failure-webhook'
import { getAppTimezone } from '@/lib/settings/timezone'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import {
  buildStatusChecks,
  summarizeStatusChecks,
  type StatusSnapshot,
} from './build-status'

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null
  const ms = Date.now() - new Date(date).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

export type OperatorStatusPayload = {
  generatedAt: string
  summary: ReturnType<typeof summarizeStatusChecks>
  auth: {
    authEnabled: boolean
    hasPassword: boolean
    hasPasskeys: boolean
    passkeyCount: number
  }
  encryption: {
    configured: boolean
    needsExportAck: boolean
    encryptionInUse: boolean
    keyCount: number
    recoveryRecipientCount: number
    activeKeyExportAcknowledged: boolean
    compromisedKeyCount: number
  }
  instanceBackup: {
    configCount: number
    enabledCount: number
    withPassphraseCount: number
    lastSuccess: {
      configId: string
      configName: string
      historyId: string
      startTime: string
      endTime: string | null
      artifactPath: string | null
      ageDays: number
    } | null
  }
  notifications: {
    failureWebhookConfigured: boolean
  }
  apiTokens: {
    activeCount: number
    remoteExecCount: number
  }
  backups: {
    total: number
    enabled: number
    encryptedOrPeerCount: number
    failedLast24h: number
    overdueSchedules: { id: string; name: string }[]
  }
  servers: {
    total: number
    passwordOnlyCount: number
  }
  cookieSecure: boolean
  checks: ReturnType<typeof buildStatusChecks>
}

/** Shared snapshot for GET /api/status and MCP get_status. */
export async function loadOperatorStatus(): Promise<OperatorStatusPayload> {
  const [
    passwordHash,
    passkeyCount,
    encryption,
    allConfigs,
    allServers,
    tokens,
    webhookRow,
    failedRecent,
    timeZone,
  ] = await Promise.all([
    getPasswordHash(),
    countPasskeys(),
    getEncryptionKeyStatus(),
    db.query.backupConfigs.findMany({
      columns: {
        id: true,
        name: true,
        enabled: true,
        sourceType: true,
        enableEncryption: true,
        destinationKind: true,
        instanceBackupPassphrase: true,
        schedule: true,
        createdAt: true,
      },
    }),
    db.query.servers.findMany({
      columns: {
        id: true,
        authType: true,
        privateKey: true,
        sshKeyId: true,
        systemKeyPath: true,
      },
    }),
    listApiTokens(false),
    db.query.settings.findFirst({
      where: eq(settings.key, FAILURE_WEBHOOK_URL_KEY),
    }),
    db.query.backupHistory.findMany({
      where: and(
        eq(backupHistory.status, 'failed'),
        gte(backupHistory.startTime, new Date(Date.now() - 24 * 60 * 60 * 1000))
      ),
      columns: { id: true },
    }),
    getAppTimezone(),
  ])

  const hasPassword = Boolean(passwordHash)
  const authEnabled = hasPassword || passkeyCount > 0

  const instanceConfigs = allConfigs.filter(
    (c) => c.sourceType === 'lazybackup_instance'
  )
  const instanceIds = instanceConfigs.map((c) => c.id)

  let lastSuccess: OperatorStatusPayload['instanceBackup']['lastSuccess'] = null

  if (instanceIds.length > 0) {
    const row = await db.query.backupHistory.findFirst({
      where: and(
        eq(backupHistory.status, 'success'),
        inArray(backupHistory.configId, instanceIds)
      ),
      orderBy: [desc(backupHistory.startTime)],
      with: {
        backupConfig: { columns: { name: true } },
      },
    })
    if (row) {
      const ageDays = daysSince(row.startTime) ?? 0
      lastSuccess = {
        configId: row.configId,
        configName: row.backupConfig?.name || 'Instance backup',
        historyId: row.id,
        startTime: new Date(row.startTime).toISOString(),
        endTime: row.endTime ? new Date(row.endTime).toISOString() : null,
        artifactPath: row.artifactPath ?? null,
        ageDays,
      }
    }
  }

  const passwordOnlyCount = allServers.filter((s) => {
    if (s.authType !== 'password') return false
    const hasKey =
      Boolean(s.privateKey?.trim()) ||
      Boolean(s.sshKeyId) ||
      Boolean(s.systemKeyPath?.trim())
    return !hasKey
  }).length

  const remoteExecCount = tokens.filter((t) =>
    t.permissions.includes('remote_exec')
  ).length

  const encryptedOrPeerCount = allConfigs.filter(
    (c) => c.enableEncryption || c.destinationKind === 'peer'
  ).length

  const enabledConfigs = allConfigs.filter((c) => c.enabled)
  const enabledIds = enabledConfigs.map((c) => c.id)
  const lastEndedByConfig = new Map<string, Date>()
  if (enabledIds.length > 0) {
    const historyRows = await db.query.backupHistory.findMany({
      where: inArray(backupHistory.configId, enabledIds),
      columns: { configId: true, endTime: true, status: true },
      orderBy: [desc(backupHistory.endTime)],
    })
    for (const row of historyRows) {
      if (lastEndedByConfig.has(row.configId)) continue
      if (row.status === 'running' || !row.endTime) continue
      lastEndedByConfig.set(row.configId, new Date(row.endTime))
    }
  }
  const now = new Date()
  const overdueSchedules = enabledConfigs
    .filter((c) =>
      isScheduleOverdue(
        c.schedule,
        lastEndedByConfig.get(c.id) ?? null,
        now,
        timeZone,
        c.createdAt
      )
    )
    .map((c) => ({ id: c.id, name: c.name }))

  const activeKey = encryption.keys.find((k) => k.status === 'active')
  const compromisedKeyCount = encryption.keys.filter(
    (k) => k.status === 'compromised'
  ).length

  const snapshot: StatusSnapshot = {
    auth: {
      authEnabled,
      authSetupCompleted: true,
      hasPassword,
      passkeyCount,
    },
    encryption: {
      configured: encryption.configured,
      needsExportAck: encryption.needsExportAck,
      encryptionInUse: encryption.encryptionInUse,
      keyCount: encryption.keys.length,
      recoveryRecipientCount: encryption.recoveryRecipients.length,
      activeKeyExportAcknowledged: Boolean(activeKey?.exportAcknowledgedAt),
      compromisedKeyCount,
    },
    instanceBackup: {
      configCount: instanceConfigs.length,
      enabledCount: instanceConfigs.filter((c) => c.enabled).length,
      withPassphraseCount: instanceConfigs.filter((c) =>
        Boolean(c.instanceBackupPassphrase?.trim())
      ).length,
      lastSuccessAgeDays: lastSuccess?.ageDays ?? null,
    },
    notifications: {
      failureWebhookConfigured: Boolean(webhookRow?.value?.trim()),
    },
    apiTokens: {
      activeCount: tokens.length,
      remoteExecCount,
    },
    backups: {
      total: allConfigs.length,
      enabled: allConfigs.filter((c) => c.enabled).length,
      encryptedOrPeerCount,
      failedLast24h: failedRecent.length,
      overdueSchedules,
    },
    servers: {
      total: allServers.length,
      passwordOnlyCount,
    },
    cookieSecure: sessionCookieSecure(),
  }

  const checks = buildStatusChecks(snapshot)
  const summary = summarizeStatusChecks(checks)

  return {
    generatedAt: new Date().toISOString(),
    summary,
    auth: {
      authEnabled,
      hasPassword,
      hasPasskeys: passkeyCount > 0,
      passkeyCount,
    },
    encryption: {
      configured: encryption.configured,
      needsExportAck: encryption.needsExportAck,
      encryptionInUse: encryption.encryptionInUse,
      keyCount: encryption.keys.length,
      recoveryRecipientCount: encryption.recoveryRecipients.length,
      activeKeyExportAcknowledged: Boolean(activeKey?.exportAcknowledgedAt),
      compromisedKeyCount,
    },
    instanceBackup: {
      configCount: instanceConfigs.length,
      enabledCount: instanceConfigs.filter((c) => c.enabled).length,
      withPassphraseCount: instanceConfigs.filter((c) =>
        Boolean(c.instanceBackupPassphrase?.trim())
      ).length,
      lastSuccess,
    },
    notifications: {
      failureWebhookConfigured: Boolean(webhookRow?.value?.trim()),
    },
    apiTokens: {
      activeCount: tokens.length,
      remoteExecCount,
    },
    backups: {
      total: allConfigs.length,
      enabled: allConfigs.filter((c) => c.enabled).length,
      encryptedOrPeerCount,
      failedLast24h: failedRecent.length,
      overdueSchedules,
    },
    servers: {
      total: allServers.length,
      passwordOnlyCount,
    },
    cookieSecure: sessionCookieSecure(),
    checks,
  }
}
