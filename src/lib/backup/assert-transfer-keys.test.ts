import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as keysModule from '@/lib/crypto/keys'

// Bun patches module namespaces in place when mocking: snapshot real exports
// first so afterAll can restore them for other test files.
const realKeys = { ...keysModule }

let activeKey: unknown = null
mock.module('@/lib/crypto/keys', () => ({
  ...realKeys,
  getActiveAgeKey: async () => activeKey,
}))

const { assertTransferServersHaveKeys } = await import('./assert-transfer-keys')

afterAll(() => {
  mock.module('@/lib/crypto/keys', () => realKeys)
})

describe('assertTransferServersHaveKeys encryption preflight', () => {
  test('refuses a friend destination without an active vault key', async () => {
    activeKey = null
    await expect(
      assertTransferServersHaveKeys({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'peer',
      })
    ).rejects.toThrow(/Create an encryption key in Settings/)
  })

  test('refuses encryption on any destination without an active key', async () => {
    activeKey = null
    await expect(
      assertTransferServersHaveKeys({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'local',
        enableEncryption: true,
      })
    ).rejects.toThrow(/Encryption is required/)
  })

  test('passes once a vault key exists', async () => {
    activeKey = { id: 'k1', status: 'active' }
    await expect(
      assertTransferServersHaveKeys({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'peer',
      })
    ).resolves.toBeUndefined()
  })

  test('unencrypted local jobs and instance backups need no vault key', async () => {
    activeKey = null
    await expect(
      assertTransferServersHaveKeys({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'local',
        enableEncryption: false,
      })
    ).resolves.toBeUndefined()
    await expect(
      assertTransferServersHaveKeys({
        sourceType: 'lazybackup_instance',
        sourceKind: 'local',
        destinationKind: 'local',
        enableEncryption: true,
      })
    ).resolves.toBeUndefined()
  })
})
