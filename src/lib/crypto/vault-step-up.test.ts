import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  assertPasswordStrength,
  hashPassword,
} from '@/lib/auth/password'
import { resetRateLimitForTests } from '@/lib/auth/rate-limit'
import * as authSettings from '@/lib/auth/settings'

const getPasswordHash = mock(async (): Promise<string | null> => null)
const verifyPassword = mock(async (): Promise<boolean> => false)
const countPasskeys = mock(async (): Promise<number> => 0)

mock.module('@/lib/auth/settings', () => ({
  ...authSettings,
  getPasswordHash,
}))

mock.module('@/lib/auth/password', () => ({
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
}))

mock.module('@/lib/auth/webauthn', () => ({
  countPasskeys,
}))

const {
  issueVaultStepUpToken,
  requireSensitiveStepUp,
  requireVaultStepUp,
  resetVaultStepUpTokens,
  vaultActionRequiresStepUp,
  VaultStepUpError,
} = await import('./vault-step-up')

test('all destructive and secret-bearing vault actions require step-up', () => {
  for (const action of [
    'reveal',
    'exportPassphrase',
    'setActive',
    'setStatus',
    'deleteKey',
    'addRecovery',
    'deleteRecovery',
    'clear',
  ]) {
    expect(vaultActionRequiresStepUp(action)).toBe(true)
  }
  expect(vaultActionRequiresStepUp('updateLabel')).toBe(false)
  expect(vaultActionRequiresStepUp('acknowledgeExport')).toBe(false)
})

describe('requireVaultStepUp', () => {
  beforeEach(() => {
    getPasswordHash.mockReset()
    verifyPassword.mockReset()
    countPasskeys.mockReset()
    getPasswordHash.mockResolvedValue(null)
    verifyPassword.mockResolvedValue(false)
    countPasskeys.mockResolvedValue(0)
    resetVaultStepUpTokens()
    resetRateLimitForTests()
  })

  test('reveal without currentPassword fails when a password is set', async () => {
    getPasswordHash.mockResolvedValue('argon2-hash')
    verifyPassword.mockResolvedValue(false)
    countPasskeys.mockResolvedValue(0)

    try {
      await requireVaultStepUp({})
      throw new Error('expected VaultStepUpError')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultStepUpError)
      expect((error as VaultStepUpError).status).toBe(403)
      expect((error as VaultStepUpError).message).toMatch(/Current password is required/)
    }
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  test('empty currentPassword fails when a password is set', async () => {
    getPasswordHash.mockResolvedValue('argon2-hash')
    await expect(requireVaultStepUp({ currentPassword: '' })).rejects.toThrow(
      /Current password is required/
    )
  })

  test('wrong currentPassword is rejected', async () => {
    getPasswordHash.mockResolvedValue('argon2-hash')
    verifyPassword.mockResolvedValue(false)

    try {
      await requireVaultStepUp({ currentPassword: 'nope' })
      throw new Error('expected VaultStepUpError')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultStepUpError)
      expect((error as VaultStepUpError).status).toBe(401)
      expect((error as VaultStepUpError).message).toMatch(/incorrect/)
    }
    expect(verifyPassword).toHaveBeenCalledWith('nope', 'argon2-hash')
  })

  test('correct currentPassword succeeds', async () => {
    getPasswordHash.mockResolvedValue('argon2-hash')
    verifyPassword.mockResolvedValue(true)
    await requireVaultStepUp({ currentPassword: 'correct-horse' })
    expect(verifyPassword).toHaveBeenCalledWith('correct-horse', 'argon2-hash')
  })

  test('passkey-only without a fresh assertion fails', async () => {
    getPasswordHash.mockResolvedValue(null)
    countPasskeys.mockResolvedValue(1)
    try {
      await requireVaultStepUp({})
      throw new Error('expected VaultStepUpError')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultStepUpError)
      expect((error as VaultStepUpError).status).toBe(403)
      expect((error as VaultStepUpError).message).toMatch(/Fresh passkey authentication/)
    }
  })

  test('passkey-only accepts one fresh token bound to the current session', async () => {
    getPasswordHash.mockResolvedValue(null)
    countPasskeys.mockResolvedValue(2)
    const cookie = 'lb_session=session-a'
    const token = issueVaultStepUpToken(cookie)
    await requireVaultStepUp({ stepUpToken: token }, cookie)
    await expect(requireVaultStepUp({ stepUpToken: token }, cookie)).rejects.toThrow(/invalid|expired/)
  })

  test('rejects a fresh token from another session', async () => {
    getPasswordHash.mockResolvedValue(null)
    countPasskeys.mockResolvedValue(1)
    const token = issueVaultStepUpToken('lb_session=session-a')
    await expect(
      requireVaultStepUp({ stepUpToken: token }, 'lb_session=session-b')
    ).rejects.toThrow(/invalid|expired/)
  })

  test('unlocked instance does not require password or confirm', async () => {
    getPasswordHash.mockResolvedValue(null)
    countPasskeys.mockResolvedValue(0)
    await requireVaultStepUp({})
    await requireSensitiveStepUp({}, undefined, { purpose: 'credentials' })
  })
})

describe('requireSensitiveStepUp (durable credentials)', () => {
  beforeEach(() => {
    getPasswordHash.mockReset()
    verifyPassword.mockReset()
    countPasskeys.mockReset()
    getPasswordHash.mockResolvedValue('argon2-hash')
    verifyPassword.mockResolvedValue(false)
    countPasskeys.mockResolvedValue(0)
    resetVaultStepUpTokens()
    resetRateLimitForTests()
  })

  test('uses credential-specific wording', async () => {
    await expect(
      requireSensitiveStepUp({}, 'lb_session=a', { purpose: 'credentials' })
    ).rejects.toThrow(/create API tokens or register passkeys/)
  })

  test('passkey-only instances require a fresh assertion', async () => {
    getPasswordHash.mockResolvedValue(null)
    countPasskeys.mockResolvedValue(1)
    try {
      await requireSensitiveStepUp({}, 'lb_session=a', { purpose: 'credentials' })
      throw new Error('expected VaultStepUpError')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultStepUpError)
      expect((error as VaultStepUpError).status).toBe(403)
      expect((error as VaultStepUpError).message).toMatch(/Fresh passkey authentication/)
    }
  })

  test('throttles repeated wrong passwords per session/IP', async () => {
    const cookie = 'lb_session=throttle-a'
    for (let i = 0; i < 5; i++) {
      await expect(
        requireSensitiveStepUp(
          { currentPassword: 'wrong' },
          cookie,
          { purpose: 'credentials', clientKey: '192.0.2.10' }
        )
      ).rejects.toThrow(/incorrect/)
    }

    try {
      await requireSensitiveStepUp(
        { currentPassword: 'wrong' },
        cookie,
        { purpose: 'credentials', clientKey: '192.0.2.10' }
      )
      throw new Error('expected rate limit')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultStepUpError)
      expect((error as VaultStepUpError).status).toBe(429)
      expect((error as VaultStepUpError).retryAfterSec).toBeGreaterThanOrEqual(1)
    }
  })

  test('a correct password resets the throttle bucket', async () => {
    const cookie = 'lb_session=throttle-b'
    const opts = { purpose: 'credentials' as const, clientKey: '192.0.2.11' }
    for (let i = 0; i < 4; i++) {
      await expect(
        requireSensitiveStepUp({ currentPassword: 'wrong' }, cookie, opts)
      ).rejects.toThrow(/incorrect/)
    }

    verifyPassword.mockResolvedValue(true)
    await requireSensitiveStepUp({ currentPassword: 'right' }, cookie, opts)

    verifyPassword.mockResolvedValue(false)
    for (let i = 0; i < 5; i++) {
      await expect(
        requireSensitiveStepUp({ currentPassword: 'wrong' }, cookie, opts)
      ).rejects.toThrow(/incorrect/)
    }
    await expect(
      requireSensitiveStepUp({ currentPassword: 'wrong' }, cookie, opts)
    ).rejects.toMatchObject({ status: 429 })
  })
})
