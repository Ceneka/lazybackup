import { getPasswordHash, verifyPassword } from '@/lib/auth'

export class VaultStepUpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'VaultStepUpError'
    this.status = status
  }
}

export type VaultStepUpInput = {
  currentPassword?: string
  confirm?: boolean
}

/**
 * Extra proof beyond the sliding session cookie for vault actions that
 * return private identities or add recovery recipients.
 *
 * - App password configured: verify `currentPassword` (same argon2 as login).
 * - Passkey-only (no password): require `confirm: true`. WebAuthn re-auth is
 *   not implemented; a stolen session can still complete these actions.
 * - Unlocked instance (no password, no passkeys): session gate only.
 */
export async function requireVaultStepUp(input: VaultStepUpInput): Promise<void> {
  const passwordHash = await getPasswordHash()
  if (passwordHash) {
    const currentPassword = input.currentPassword ?? ''
    if (!currentPassword) {
      throw new VaultStepUpError(
        'Current password is required to export or change the encryption vault',
        403
      )
    }
    const valid = await verifyPassword(currentPassword, passwordHash)
    if (!valid) {
      throw new VaultStepUpError('Current password is incorrect', 401)
    }
    return
  }

  const { countPasskeys } = await import('@/lib/auth/webauthn')
  if ((await countPasskeys()) > 0 && input.confirm !== true) {
    throw new VaultStepUpError(
      'Passkey-only instance: send confirm: true to proceed. WebAuthn step-up is not implemented; a stolen session can still complete this action.',
      403
    )
  }
}
