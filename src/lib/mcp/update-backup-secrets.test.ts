import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

type Row = Record<string, unknown> | null

let configFixture: Row = null
const updates: Array<Record<string, unknown>> = []

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupConfigs: {
        findFirst: async () => configFixture,
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return { where: async () => undefined }
      },
    }),
  },
}))

mock.module('@/lib/auth/audit', () => ({
  writeAuditLog: async () => undefined,
}))

mock.module('@/lib/backup', () => ({
  executeBackup: async () => undefined,
  restoreDatabaseBackup: async () => ({}),
  restoreDockerVolumeBackup: async () => ({}),
  restoreGitRepoBackup: async () => ({}),
  restorePathBackup: async () => ({}),
}))

mock.module('@/lib/backup/validate', () => ({
  attachLastValidation: (config: unknown) => config,
  validateBackupConfig: async () => ({ ok: true, checks: [] }),
}))

mock.module('@/lib/backup/destination-guard', () => ({
  findExactDestinationConflict: async () => null,
}))

mock.module('@/lib/backup/assert-transfer-keys', () => ({
  assertTransferServersHaveKeys: async () => undefined,
}))

mock.module('@/lib/scheduler', () => ({
  scheduleBackup: async () => undefined,
  stopBackup: () => undefined,
}))

mock.module('@/lib/peer/recall', () => ({
  PeerRecallPendingError: class PeerRecallPendingError extends Error {},
  peerRecallWaitingResponse: (recallId: string) => ({ recallId }),
}))

mock.module('@/lib/peer/delivery-state', () => ({
  deliveryStateForHistoryRow: () => null,
}))

mock.module('@/lib/api/history-query', () => ({
  publicPeerColumns: {},
}))

mock.module('@/lib/status/load-status', () => ({
  loadOperatorStatus: async () => ({}),
}))

mock.module('@/lib/ssh/exec-remote', () => ({
  execRemoteCommand: async () => ({ exitCode: 0 }),
}))

const { updateBackupOp } = await import('@/lib/mcp/operations')

const ctx = { canWrite: true, canRemoteExec: true } as const

function databaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'DB backup',
    sourceKind: 'server',
    serverId: 'srv-1',
    destinationKind: 'local',
    destinationPath: '/backups/db',
    sourceType: 'database',
    sourcePath: 'appdb',
    schedule: '0 3 * * *',
    dbEngine: 'postgres',
    dbClient: 'native',
    dbUser: 'postgres',
    dbPassword: '',
    ...overrides,
  }
}

function pathConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Path backup',
    sourceKind: 'server',
    serverId: 'srv-1',
    destinationKind: 'local',
    destinationPath: '/backups/app',
    sourceType: 'path',
    sourcePath: '/srv/app',
    schedule: '0 3 * * *',
    ...overrides,
  }
}

function instanceConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Instance backup',
    sourceKind: 'local',
    destinationKind: 'local',
    destinationPath: '/backups/instance',
    sourceType: 'lazybackup_instance',
    sourcePath: 'ignored',
    schedule: '0 3 * * *',
    instanceBackupPassphrase: '',
    ...overrides,
  }
}

function lastUpdate() {
  const update = updates.at(-1)
  if (!update) throw new Error('no db update was recorded')
  return update
}

beforeEach(() => {
  configFixture = null
  updates.length = 0
})

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore()
  const freshDb = await import(`../db/index.ts?real=${Date.now()}`)
  mock.module('@/lib/db', () => freshDb)
})

describe('updateBackupOp secret preservation', () => {
  test('keeps the stored dbPassword when the update sends a blank value', async () => {
    configFixture = {
      id: 'cfg-1',
      name: 'DB backup',
      sourceKind: 'server',
      serverId: 'srv-1',
      destinationKind: 'local',
      destinationPath: '/backups/db',
      sourceType: 'database',
      sourcePath: 'appdb',
      schedule: '0 3 * * *',
      dbEngine: 'postgres',
      dbClient: 'native',
      dbUser: 'postgres',
      dbPassword: 'secret123',
      instanceBackupPassphrase: null,
      preBackupCommands: null,
      enabled: false,
    }

    const result = await updateBackupOp(ctx, 'cfg-1', databaseConfig({ dbPassword: '' }))

    expect('isError' in result).toBe(false)
    expect(updates).toHaveLength(1)
    expect(lastUpdate().dbPassword).toBe('secret123')
    expect(lastUpdate().instanceBackupPassphrase).toBeNull()
  })

  test('keeps the stored dbPassword when the update omits the field', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'database',
      dbPassword: 'secret123',
      instanceBackupPassphrase: null,
      preBackupCommands: null,
      enabled: false,
    }
    const input = databaseConfig()
    delete (input as { dbPassword?: string }).dbPassword

    await updateBackupOp(ctx, 'cfg-1', input)

    expect(lastUpdate().dbPassword).toBe('secret123')
  })

  test('replaces the stored dbPassword with a non-blank value', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'database',
      dbPassword: 'secret123',
      instanceBackupPassphrase: null,
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(ctx, 'cfg-1', databaseConfig({ dbPassword: 'newpass' }))

    expect(lastUpdate().dbPassword).toBe('newpass')
  })

  test('clears the dbPassword when switching the engine to sqlite', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'database',
      dbEngine: 'postgres',
      dbPassword: 'secret123',
      instanceBackupPassphrase: null,
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(
      ctx,
      'cfg-1',
      databaseConfig({
        sourcePath: '/srv/app.db',
        dbEngine: 'sqlite',
        dbClient: 'native',
        dbUser: '',
        dbPassword: '',
      })
    )

    expect(lastUpdate().dbPassword).toBeNull()
  })

  test('clears the dbPassword when the new source type does not use it', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'database',
      dbPassword: 'secret123',
      instanceBackupPassphrase: null,
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(ctx, 'cfg-1', pathConfig())

    expect(lastUpdate().dbPassword).toBeNull()
    expect(lastUpdate().instanceBackupPassphrase).toBeNull()
  })

  test('keeps the stored instance passphrase when the update sends a blank value', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'lazybackup_instance',
      instanceBackupPassphrase: 'correct horse battery',
      dbPassword: null,
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(ctx, 'cfg-1', instanceConfig({ instanceBackupPassphrase: '' }))

    expect(lastUpdate().instanceBackupPassphrase).toBe('correct horse battery')
    expect(lastUpdate().dbPassword).toBeNull()
  })

  test('replaces the stored instance passphrase and clears the dbPassword', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'lazybackup_instance',
      instanceBackupPassphrase: 'correct horse battery',
      dbPassword: 'secret123',
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(
      ctx,
      'cfg-1',
      instanceConfig({ instanceBackupPassphrase: 'new passphrase ok' })
    )

    expect(lastUpdate().instanceBackupPassphrase).toBe('new passphrase ok')
    expect(lastUpdate().dbPassword).toBeNull()
  })

  test('clears the instance passphrase when switching to a path source', async () => {
    configFixture = {
      id: 'cfg-1',
      sourceType: 'lazybackup_instance',
      instanceBackupPassphrase: 'correct horse battery',
      dbPassword: null,
      preBackupCommands: null,
      enabled: false,
    }

    await updateBackupOp(ctx, 'cfg-1', pathConfig())

    expect(lastUpdate().instanceBackupPassphrase).toBeNull()
  })
})
