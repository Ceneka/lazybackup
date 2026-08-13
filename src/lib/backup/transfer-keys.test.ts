import { describe, expect, test } from 'bun:test'
import {
  passwordOnlyPathTransferError,
  pathJobUsesServerEndpoint,
} from './transfer-keys'

describe('pathJobUsesServerEndpoint', () => {
  test('true for path jobs with a server source', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceType: 'path',
        sourceKind: 'server',
        destinationKind: 'local',
      })
    ).toBe(true)
  })

  test('true for path jobs with a server destination', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'server',
      })
    ).toBe(true)
  })

  test('defaults missing sourceType to path', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceKind: 'server',
        destinationKind: 'local',
      })
    ).toBe(true)
  })

  test('false for local-only path jobs', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceType: 'path',
        sourceKind: 'local',
        destinationKind: 'local',
      })
    ).toBe(false)
  })

  test('false for database dumps even with a server source', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceType: 'database',
        sourceKind: 'server',
        destinationKind: 'local',
      })
    ).toBe(false)
  })

  test('false for docker volume packs', () => {
    expect(
      pathJobUsesServerEndpoint({
        sourceType: 'docker_volume',
        sourceKind: 'server',
        destinationKind: 'local',
      })
    ).toBe(false)
  })
})

describe('passwordOnlyPathTransferError', () => {
  test('null when every server uses a key', () => {
    expect(
      passwordOnlyPathTransferError([
        { name: 'Prod', authType: 'key' },
        { name: 'Offsite', authType: 'key' },
      ])
    ).toBeNull()
  })

  test('names password-only servers', () => {
    const message = passwordOnlyPathTransferError([
      { name: 'Prod', authType: 'key' },
      { name: 'Legacy', authType: 'password' },
    ])
    expect(message).toContain('Legacy')
    expect(message).not.toContain('Prod')
    expect(message).toContain('SSH key')
  })
})
