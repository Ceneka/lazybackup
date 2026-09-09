import { describe, expect, test } from 'bun:test'
import { APP_VERSION } from '@/lib/app-version'
import { buildConfigExport, redactExportHeaderSetting } from './export-config'

const PLANTED_SERVER_PASSWORD = 'super-secret-ssh-password'
const PLANTED_PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nplanted-pem\n'
const PLANTED_SSH_CONTENT = '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-key-blob\n'
const PLANTED_S3_SECRET = 's3-secret-access-key-value'
const PLANTED_S3_ACCESS = 'AKIAPLANTACCESS'
const PLANTED_DB_PASSWORD = 'db-password-should-not-leak'
const PLANTED_INSTANCE_PASSPHRASE = 'instance-wrap-passphrase'
const PLANTED_APP_HASH = '$2b$12$plantedAppPasswordHash'
const PLANTED_SESSION_SECRET = 'planted-session-secret-bytes'
const PLANTED_HEADER_TOKEN = 'Bearer ghp_plantedwebhooktoken'
const PLANTED_AGE_IDENTITY = 'AGE-SECRET-KEY-1PLANTEDIDENTITY'

function fakeExport() {
  return buildConfigExport({
    servers: [
      {
        id: 's1',
        name: 'box',
        host: '1.2.3.4',
        port: 22,
        username: 'root',
        authType: 'password',
        password: PLANTED_SERVER_PASSWORD,
        privateKey: PLANTED_PRIVATE_KEY,
        sshKeyId: null,
        systemKeyPath: null,
      },
    ],
    sshKeys: [
      {
        id: 'k1',
        name: 'laptop',
        privateKeyContent: PLANTED_SSH_CONTENT,
        privateKeyPath: '/root/.ssh/id_ed25519',
      },
    ],
    s3Profiles: [
      {
        id: 'p1',
        name: 'minio',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'backups',
        forcePathStyle: true,
        accessKeyId: PLANTED_S3_ACCESS,
        secretAccessKey: PLANTED_S3_SECRET,
      },
    ],
    backupConfigs: [
      {
        id: 'b1',
        name: 'Daily DB',
        enabled: true,
        sourceKind: 'server',
        destinationKind: 'local',
        serverId: 's1',
        sourceType: 'database',
        sourcePath: 'app',
        destinationPath: '/backups/box/db',
        schedule: '0 2 * * *',
        excludePatterns: '["tmp"]',
        enableEncryption: true,
        deleteExtraneous: false,
        enableVersioning: true,
        versionsToKeep: 5,
        enableFileRetention: false,
        dbEngine: 'postgres',
        dbClient: 'native',
        dbHost: '127.0.0.1',
        dbPort: 5432,
        dbUser: 'postgres',
        dbPassword: PLANTED_DB_PASSWORD,
        instanceBackupPassphrase: PLANTED_INSTANCE_PASSPHRASE,
      },
    ],
    settings: [
      { key: 'timezone', value: 'UTC' },
      { key: 'appPasswordHash', value: PLANTED_APP_HASH },
      { key: 'sessionSecret', value: PLANTED_SESSION_SECRET },
      { key: 'sessionEpoch', value: '3' },
      { key: 'ageIdentity', value: PLANTED_AGE_IDENTITY },
      { key: 'failureWebhookUrl', value: 'https://hooks.example.com/notify' },
      {
        key: 'failureWebhookHeaders',
        value: `Authorization: ${PLANTED_HEADER_TOKEN}\nContent-Type: application/json`,
      },
    ],
    exportedAt: new Date('2026-09-02T12:00:00.000Z'),
    version: APP_VERSION,
  })
}

describe('buildConfigExport', () => {
  test('omits server password and private key from JSON', () => {
    const snapshot = fakeExport()
    const json = JSON.stringify(snapshot)

    expect(json).not.toContain(PLANTED_SERVER_PASSWORD)
    expect(json).not.toContain('BEGIN OPENSSH')
    expect(json).not.toContain('planted-pem')
    expect(snapshot.servers[0]).not.toHaveProperty('password')
    expect(snapshot.servers[0]).not.toHaveProperty('privateKey')
    expect(snapshot.servers[0]).toMatchObject({
      id: 's1',
      name: 'box',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
      hasPassword: true,
      hasPrivateKey: true,
    })
  })

  test('omits SSH key content, S3 keys, db password, and passphrase', () => {
    const snapshot = fakeExport()
    const json = JSON.stringify(snapshot)

    expect(json).not.toContain(PLANTED_SSH_CONTENT)
    expect(json).not.toContain(PLANTED_S3_SECRET)
    expect(json).not.toContain(PLANTED_S3_ACCESS)
    expect(json).not.toContain(PLANTED_DB_PASSWORD)
    expect(json).not.toContain(PLANTED_INSTANCE_PASSPHRASE)

    expect(snapshot.sshKeys[0]).toEqual({
      id: 'k1',
      name: 'laptop',
      hasContent: true,
      usesPath: true,
    })
    expect(snapshot.sshKeys[0]).not.toHaveProperty('privateKeyContent')
    expect(snapshot.s3Profiles[0]).not.toHaveProperty('accessKeyId')
    expect(snapshot.s3Profiles[0]).not.toHaveProperty('secretAccessKey')
    expect(snapshot.backupConfigs[0]).not.toHaveProperty('dbPassword')
    expect(snapshot.backupConfigs[0]).not.toHaveProperty('instanceBackupPassphrase')
    expect(snapshot.backupConfigs[0]).toMatchObject({
      dbEngine: 'postgres',
      dbHost: '127.0.0.1',
      dbUser: 'postgres',
      hasDbPassword: true,
      hasInstanceBackupPassphrase: true,
    })
  })

  test('omits auth hashes and redacts webhook header secrets', () => {
    const snapshot = fakeExport()
    const json = JSON.stringify(snapshot)

    expect(json).not.toContain(PLANTED_APP_HASH)
    expect(json).not.toContain(PLANTED_SESSION_SECRET)
    expect(json).not.toContain(PLANTED_AGE_IDENTITY)
    expect(json).not.toContain(PLANTED_HEADER_TOKEN)
    expect(json).not.toContain('ghp_plantedwebhooktoken')
    expect(snapshot.settings).not.toHaveProperty('appPasswordHash')
    expect(snapshot.settings).not.toHaveProperty('sessionSecret')
    expect(snapshot.settings).not.toHaveProperty('ageIdentity')
    expect(snapshot.settings.timezone).toBe('UTC')
    expect(snapshot.settings.failureWebhookUrl).toBe('https://hooks.example.com/notify')
    expect(snapshot.settings.failureWebhookHeaders).toContain('***')
    expect(snapshot.settings.failureWebhookHeaders).toContain('Content-Type: application/json')
    expect(snapshot.metadata.version).toBe(APP_VERSION)
    expect(snapshot.metadata.exportedAt).toBe('2026-09-02T12:00:00.000Z')
    expect(snapshot.gitRepos).toEqual([])
  })
})

describe('redactExportHeaderSetting', () => {
  test('redacts Authorization and keeps Content-Type', () => {
    const result = redactExportHeaderSetting(
      'Authorization: Bearer secret-token\nContent-Type: application/json'
    )
    expect(result).toContain('Authorization: ***')
    expect(result).toContain('Content-Type: application/json')
    expect(result).not.toContain('secret-token')
  })

  test('redacts JSON header objects', () => {
    const result = redactExportHeaderSetting(
      '{"Authorization":"Bearer x","Content-Type":"application/json"}'
    )
    expect(result).toBe(
      JSON.stringify({ Authorization: '***', 'Content-Type': 'application/json' })
    )
  })

  test('unparseable header blobs become stars', () => {
    expect(redactExportHeaderSetting('Host: evil')).toBe('***')
  })
})
