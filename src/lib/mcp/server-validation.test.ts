import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

type Row = Record<string, unknown> | null

// The MCP server tools used to bypass the REST credential validation. These
// tests pin the shared rules (port bounds, key material, password required,
// blank-on-update keeps the stored secret).
let serverFixture: Row = null
let storedKeyFixture: Row = null
const inserts: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []

mock.module('@/lib/db', () => ({
  db: {
    query: {
      servers: { findFirst: async () => serverFixture },
      sshKeys: { findFirst: async () => storedKeyFixture },
    },
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push(values)
      },
    }),
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
  PeerRecallPendingError: class extends Error {},
  peerRecallWaitingResponse: () => ({}),
}))

mock.module('@/lib/peer/delivery-state', () => ({
  deliveryStateForHistoryRow: () => 'stored',
}))

mock.module('@/lib/api/history-query', () => ({
  publicPeerColumns: {},
}))

mock.module('@/lib/status/load-status', () => ({
  loadOperatorStatus: async () => ({}),
}))

mock.module('@/lib/ssh/exec-remote', () => ({
  execRemoteCommand: async () => ({ stdout: '', stderr: '', code: 0 }),
}))

const { createServerOp, updateServerOp } = await import('./operations')

const ctx = { actor: { kind: 'token', id: 'qa' } } as never

function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? []
  return content.map((c) => c.text ?? '').join('\n')
}

beforeEach(() => {
  serverFixture = null
  storedKeyFixture = null
  inserts.length = 0
  updates.length = 0
})

afterAll(() => {
  mock.restore()
})

describe('MCP server tools share the REST credential rules', () => {
  test('create rejects an unparseable private key', async () => {
    const result = await createServerOp(ctx, {
      name: 'bad',
      host: 'h.example',
      username: 'u',
      authType: 'key',
      privateKey: 'not-a-key',
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(text(result).toLowerCase()).toContain('key')
    expect(inserts).toHaveLength(0)
  })

  test('create rejects a port above 65535', async () => {
    const result = await createServerOp(ctx, {
      name: 'bad-port',
      host: 'h.example',
      username: 'u',
      authType: 'password',
      password: 'secret',
      port: 99999,
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(inserts).toHaveLength(0)
  })

  test('create rejects password auth without a password', async () => {
    const result = await createServerOp(ctx, {
      name: 'no-password',
      host: 'h.example',
      username: 'u',
      authType: 'password',
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(text(result)).toContain('Password is required')
    expect(inserts).toHaveLength(0)
  })

  test('create accepts valid password auth', async () => {
    const result = await createServerOp(ctx, {
      name: 'ok',
      host: 'h.example',
      username: 'u',
      authType: 'password',
      password: 'secret',
      port: 22,
    })
    expect((result as { isError?: boolean }).isError).toBeUndefined()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].port).toBe(22)
  })

  test('update with a blank password keeps the stored one', async () => {
    serverFixture = {
      id: 's1',
      name: 'srv',
      host: 'h.example',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'stored-secret',
      privateKey: null,
      sshKeyId: null,
      systemKeyPath: null,
    }
    const result = await updateServerOp(ctx, 's1', {
      name: 'srv renamed',
      host: 'h.example',
      username: 'u',
      authType: 'password',
      password: '',
    })
    expect((result as { isError?: boolean }).isError).toBeUndefined()
    expect(updates).toHaveLength(1)
    expect(updates[0].password).toBe('stored-secret')
  })

  test('update rejects switching to key auth with nothing usable', async () => {
    serverFixture = {
      id: 's1',
      name: 'srv',
      host: 'h.example',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'stored-secret',
      privateKey: null,
      sshKeyId: null,
      systemKeyPath: null,
    }
    const result = await updateServerOp(ctx, 's1', {
      name: 'srv',
      host: 'h.example',
      username: 'u',
      authType: 'key',
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(updates).toHaveLength(0)
  })
})
