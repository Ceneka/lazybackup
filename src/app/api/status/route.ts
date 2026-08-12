import {
  isSessionAuthorized,
  listApiTokens,
  sessionCookieSecure,
} from '@/lib/auth'
import { getPasswordHash } from '@/lib/auth/settings'
import { countPasskeys } from '@/lib/auth/webauthn'
import { getEncryptionKeyStatus } from '@/lib/crypto/keys'
import { db } from '@/lib/db'
import { backupHistory, settings } from '@/lib/db/schema'
import { FAILURE_WEBHOOK_URL_KEY } from '@/lib/notify/failure-webhook'
import {
  buildStatusChecks,
  summarizeStatusChecks,
  type StatusSnapshot,
} from '@/lib/status/build-status'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null
  const ms = Date.now() - new Date(date).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

/** GET /api/status — operator safety posture (session required) */
export async function GET(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [
      passwordHash,
      passkeyCount,
      encryption,
      allConfigs,
      allServers,
      tokens,
      webhookRow,
      failedRecent,
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
    ])

    const hasPassword = Boolean(passwordHash)
    const authEnabled = hasPassword || passkeyCount > 0

    const instanceConfigs = allConfigs.filter(
      (c) => c.sourceType === 'lazybackup_instance'
    )
    const instanceIds = instanceConfigs.map((c) => c.id)

    let lastSuccess: {
      configId: string
      configName: string
      historyId: string
      startTime: string
      endTime: string | null
      artifactPath: string | null
      ageDays: number
    } | null = null

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
      },
      servers: {
        total: allServers.length,
        passwordOnlyCount,
      },
      cookieSecure: sessionCookieSecure(),
    }

    const checks = buildStatusChecks(snapshot)
    const summary = summarizeStatusChecks(checks)

    return NextResponse.json({
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
      },
      servers: {
        total: allServers.length,
        passwordOnlyCount,
      },
      cookieSecure: sessionCookieSecure(),
      checks,
    })
  } catch (error) {
    console.error('Failed to build status:', error)
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 })
  }
}
