import { getPasswordHash, verifyPassword } from '@/lib/auth'
import { SESSION_COOKIE_NAME, parseCookieValue } from '@/lib/auth/session'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

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
  stepUpToken?: string
}

export const VAULT_STEP_UP_ACTIONS = new Set([
  'generate',
  'import',
  'reveal',
  'exportPassphrase',
  'setActive',
  'setStatus',
  'deleteKey',
  'addRecovery',
  'deleteRecovery',
  'clear',
])

export function vaultActionRequiresStepUp(action: string): boolean {
  return VAULT_STEP_UP_ACTIONS.has(action)
}

const STEP_UP_TTL_MS = 2 * 60 * 1000
const MAX_STEP_UP_TOKENS = 64
const stepUpTokens = new Map<string, { sessionHash: string; expiresAt: number }>()

function sessionHash(cookieHeader: string | null | undefined): string | null {
  const session = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
  return session ? createHash('sha256').update(session).digest('hex') : null
}

function pruneStepUpTokens(now = Date.now()) {
  for (const [token, proof] of stepUpTokens) {
    if (proof.expiresAt <= now) stepUpTokens.delete(token)
  }
  while (stepUpTokens.size > MAX_STEP_UP_TOKENS) {
    const oldest = stepUpTokens.keys().next().value
    if (!oldest) break
    stepUpTokens.delete(oldest)
  }
}

export function issueVaultStepUpToken(cookieHeader: string | null | undefined): string {
  const boundSession = sessionHash(cookieHeader)
  if (!boundSession) {
    throw new VaultStepUpError('A valid browser session is required', 401)
  }
  pruneStepUpTokens()
  const token = randomBytes(32).toString('base64url')
  stepUpTokens.set(token, {
    sessionHash: boundSession,
    expiresAt: Date.now() + STEP_UP_TTL_MS,
  })
  return token
}

export function consumeVaultStepUpToken(
  token: string | null | undefined,
  cookieHeader: string | null | undefined
): boolean {
  if (!token) return false
  pruneStepUpTokens()
  const proof = stepUpTokens.get(token)
  stepUpTokens.delete(token)
  const boundSession = sessionHash(cookieHeader)
  if (!proof || !boundSession || proof.expiresAt <= Date.now()) return false
  const a = Buffer.from(proof.sessionHash)
  const b = Buffer.from(boundSession)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export function resetVaultStepUpTokens(): void {
  stepUpTokens.clear()
}

/**
 * Extra proof beyond the sliding session cookie for vault actions that
 * reveal, export, or mutate encryption key material.
 *
 * - A freshly verified WebAuthn assertion yields a short-lived, one-use token
 *   bound to the current session cookie.
 * - App password setups may instead verify `currentPassword`.
 * - Unlocked instance (no password, no passkeys): session gate only.
 */
export async function requireVaultStepUp(
  input: VaultStepUpInput,
  cookieHeader?: string | null
): Promise<void> {
  if (input.stepUpToken) {
    if (consumeVaultStepUpToken(input.stepUpToken, cookieHeader)) return
    throw new VaultStepUpError('Fresh passkey authentication is invalid or expired', 401)
  }

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
  if ((await countPasskeys()) > 0) {
    throw new VaultStepUpError(
      'Fresh passkey authentication is required to change the encryption vault',
      403
    )
  }
}
