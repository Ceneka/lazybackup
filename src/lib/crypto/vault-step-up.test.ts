import { beforeEach, describe, expect, mock, test } from 'bun:test'

const getPasswordHash = mock(async (): Promise<string | null> => null)
const verifyPassword = mock(async (): Promise<boolean> => false)
const countPasskeys = mock(async (): Promise<number> => 0)

mock.module('@/lib/auth', () => ({
  getPasswordHash,
  verifyPassword,
}))

mock.module('@/lib/auth/webauthn', () => ({
  countPasskeys,
}))

const {
  issueVaultStepUpToken,
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
  })
})
