import { redactServer, redactSshKey } from '@/lib/api/redact'
import { APP_VERSION } from '@/lib/app-version'
import { SENSITIVE_SETTING_KEYS } from '@/lib/auth/constants'
import { db } from '@/lib/db'
import {
  backupConfigs,
  s3Profiles,
  servers,
  settings,
  sshKeys,
} from '@/lib/db/schema'
import { parseWebhookHeaders } from '@/lib/notify/failure-webhook'

const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_SETTING_KEYS)

const HEADER_SETTING_KEYS = new Set([
  'failureWebhookHeaders',
  'successPingHeaders',
])

/** Header names whose values are not treated as credentials. */
const PASSTHROUGH_HEADER_NAMES = new Set(['content-type', 'accept'])

const SECRET_KEY_PATTERN = /hash|secret|password|identity|privatekey|passphrase|tokenhash/i

export type ExportServerRow = {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: string
  password?: string | null
  privateKey?: string | null
  sshKeyId?: string | null
  systemKeyPath?: string | null
}

export type ExportSshKeyRow = {
  id: string
  name: string
  privateKeyContent?: string | null
  privateKeyPath?: string | null
}

export type ExportS3Row = {
  id: string
  name: string
  endpoint: string
  region: string
  bucket: string
  forcePathStyle: boolean
  accessKeyId?: string | null
  secretAccessKey?: string | null
}

export type ExportBackupRow = {
  id: string
  name: string
  enabled: boolean
  sourceKind: string
  destinationKind: string
  serverId?: string | null
  destinationServerId?: string | null
  sourceS3ProfileId?: string | null
  destinationS3ProfileId?: string | null
  destinationPeerId?: string | null
  sourceType: string
  sourcePath: string
  destinationPath: string
  schedule: string
  excludePatterns?: string | null
  enableEncryption: boolean
  deleteExtraneous: boolean
  enableVersioning: boolean
  versionsToKeep?: number | null
  enableFileRetention: boolean
  retentionMaxAge?: number | null
  retentionMaxAgeUnit?: string | null
  retentionMinKeep?: number | null
  dbEngine?: string | null
  dbClient?: string | null
  dbContainer?: string | null
  dbHost?: string | null
  dbPort?: number | null
  dbUser?: string | null
  dbPassword?: string | null
  instanceBackupPassphrase?: string | null
}

export type ExportSettingRow = {
  key: string
  value: string | null
}

export type ConfigExportInput = {
  servers: ExportServerRow[]
  sshKeys: ExportSshKeyRow[]
  s3Profiles: ExportS3Row[]
  backupConfigs: ExportBackupRow[]
  settings: ExportSettingRow[]
  exportedAt?: Date
  version?: string
}

export type ConfigExportSnapshot = {
  metadata: {
    exportedAt: string
    version: string
  }
  servers: Array<{
    id: string
    name: string
    host: string
    port: number
    username: string
    authType: string
    sshKeyId: string | null
    systemKeyPath: string | null
    hasPassword: boolean
    hasPrivateKey: boolean
  }>
  sshKeys: Array<{
    id: string
    name: string
    hasContent: boolean
    usesPath: boolean
  }>
  s3Profiles: Array<{
    id: string
    name: string
    endpoint: string
    region: string
    bucket: string
    forcePathStyle: boolean
  }>
  backupConfigs: Array<{
    id: string
    name: string
    enabled: boolean
    sourceKind: string
    destinationKind: string
    serverId: string | null
    destinationServerId: string | null
    sourceS3ProfileId: string | null
    destinationS3ProfileId: string | null
    destinationPeerId: string | null
    sourceType: string
    sourcePath: string
    destinationPath: string
    schedule: string
    excludePatterns: string | null
    enableEncryption: boolean
    deleteExtraneous: boolean
    enableVersioning: boolean
    versionsToKeep: number | null
    enableFileRetention: boolean
    retentionMaxAge: number | null
    retentionMaxAgeUnit: string | null
    retentionMinKeep: number | null
    dbEngine: string | null
    dbClient: string | null
    dbContainer: string | null
    dbHost: string | null
    dbPort: number | null
    dbUser: string | null
    hasDbPassword: boolean
    hasInstanceBackupPassphrase: boolean
  }>
  settings: Record<string, string | null>
}

function isSecretSettingKey(key: string): boolean {
  if (SENSITIVE_KEY_SET.has(key)) return true
  return SECRET_KEY_PATTERN.test(key)
}

/**
 * Keep header names, replace credential-like values with `***`.
 * Unparseable blobs become `***` so we never leak a raw secret string.
 */
export function redactExportHeaderSetting(raw: string | null): string | null {
  if (raw == null) return null
  if (!raw.trim()) return raw
  const parsed = parseWebhookHeaders(raw)
  if (!parsed.ok) {
    return '***'
  }
  const lines: string[] = []
  for (const [name, value] of Object.entries(parsed.headers)) {
    if (PASSTHROUGH_HEADER_NAMES.has(name.toLowerCase())) {
      lines.push(`${name}: ${value}`)
    } else {
      lines.push(`${name}: ***`)
    }
  }
  if (raw.trim().startsWith('{')) {
    const obj: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed.headers)) {
      obj[name] = PASSTHROUGH_HEADER_NAMES.has(name.toLowerCase()) ? value : '***'
    }
    return JSON.stringify(obj)
  }
  return lines.join('\n')
}

export function exportSettingsMap(
  rows: ExportSettingRow[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const row of rows) {
    if (isSecretSettingKey(row.key)) continue
    if (HEADER_SETTING_KEYS.has(row.key)) {
      out[row.key] = redactExportHeaderSetting(row.value)
      continue
    }
    out[row.key] = row.value
  }
  return out
}

function exportServer(row: ExportServerRow) {
  const redacted = redactServer(row as unknown as Record<string, unknown>)
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    sshKeyId: row.sshKeyId ?? null,
    systemKeyPath: row.systemKeyPath ?? null,
    hasPassword: Boolean(redacted.hasPassword),
    hasPrivateKey: Boolean(redacted.hasPrivateKey),
  }
}

function exportSshKey(row: ExportSshKeyRow) {
  const redacted = redactSshKey(row as unknown as Record<string, unknown>)
  return {
    id: row.id,
    name: row.name,
    hasContent: Boolean(redacted.hasPrivateKeyContent),
    usesPath: Boolean(row.privateKeyPath?.trim()),
  }
}

function exportS3(row: ExportS3Row) {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    forcePathStyle: Boolean(row.forcePathStyle),
  }
}

function exportBackup(row: ExportBackupRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    sourceKind: row.sourceKind,
    destinationKind: row.destinationKind,
    serverId: row.serverId ?? null,
    destinationServerId: row.destinationServerId ?? null,
    sourceS3ProfileId: row.sourceS3ProfileId ?? null,
    destinationS3ProfileId: row.destinationS3ProfileId ?? null,
    destinationPeerId: row.destinationPeerId ?? null,
    sourceType: row.sourceType,
    sourcePath: row.sourcePath,
    destinationPath: row.destinationPath,
    schedule: row.schedule,
    excludePatterns: row.excludePatterns ?? null,
    enableEncryption: Boolean(row.enableEncryption),
    deleteExtraneous: Boolean(row.deleteExtraneous),
    enableVersioning: Boolean(row.enableVersioning),
    versionsToKeep: row.versionsToKeep ?? null,
    enableFileRetention: Boolean(row.enableFileRetention),
    retentionMaxAge: row.retentionMaxAge ?? null,
    retentionMaxAgeUnit: row.retentionMaxAgeUnit ?? null,
    retentionMinKeep: row.retentionMinKeep ?? null,
    dbEngine: row.dbEngine ?? null,
    dbClient: row.dbClient ?? null,
    dbContainer: row.dbContainer ?? null,
    dbHost: row.dbHost ?? null,
    dbPort: row.dbPort ?? null,
    dbUser: row.dbUser ?? null,
    hasDbPassword: Boolean(row.dbPassword),
    hasInstanceBackupPassphrase: Boolean(row.instanceBackupPassphrase),
  }
}

/** Pure snapshot builder — used by tests with fake rows (no DB). */
export function buildConfigExport(input: ConfigExportInput): ConfigExportSnapshot {
  const exportedAt = (input.exportedAt ?? new Date()).toISOString()
  return {
    metadata: {
      exportedAt,
      version: input.version ?? APP_VERSION,
    },
    servers: input.servers.map(exportServer),
    sshKeys: input.sshKeys.map(exportSshKey),
    s3Profiles: input.s3Profiles.map(exportS3),
    backupConfigs: input.backupConfigs.map(exportBackup),
    settings: exportSettingsMap(input.settings),
  }
}

export async function loadConfigExport(): Promise<ConfigExportSnapshot> {
  const [serverRows, sshKeyRows, s3Rows, backupRows, settingRows] = await Promise.all([
    db.select().from(servers),
    db.select().from(sshKeys),
    db.select().from(s3Profiles),
    db.select().from(backupConfigs),
    db.select().from(settings),
  ])

  return buildConfigExport({
    servers: serverRows,
    sshKeys: sshKeyRows,
    s3Profiles: s3Rows,
    backupConfigs: backupRows,
    settings: settingRows,
  })
}
