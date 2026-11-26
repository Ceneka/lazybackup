import { verifyPassword } from '@/lib/auth/password'
import {
  assertNotRateLimited,
  clientKeyFromRequest,
  rateLimitKey,
  recordAuthFailure,
  recordAuthSuccess,
} from '@/lib/auth/rate-limit'
import { getPasswordHash } from '@/lib/auth/settings'
import { SESSION_COOKIE_NAME, parseCookieValue } from '@/lib/auth/session'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export class VaultStepUpError extends Error {
  readonly status: number
  readonly retryAfterSec?: number

  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message)
    this.name = 'VaultStepUpError'
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

export type VaultStepUpInput = {
  currentPassword?: string
  stepUpToken?: string
}

export type StepUpPurpose = 'vault' | 'credentials'

export type StepUpOptions = {
  /** 'credentials' tailors messages for API tokens / passkey registration. */
  purpose?: StepUpPurpose
  /** Per-request client key (respects AUTH_TRUST_PROXY); combined with session. */
  clientKey?: string
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

function messagesFor(purpose: StepUpPurpose) {
  return purpose === 'credentials'
    ? {
        tokenInvalid:
          'Fresh passkey authentication is invalid or expired',
        required:
          'Current password is required to create API tokens or register passkeys',
        incorrect: 'Current password is incorrect',
        passkeyRequired:
          'Fresh passkey authentication is required to create API tokens or register passkeys',
      }
    : {
        tokenInvalid:
          'Fresh passkey authentication is invalid or expired',
        required:
          'Current password is required to export or change the encryption vault',
        incorrect: 'Current password is incorrect',
        passkeyRequired:
          'Fresh passkey authentication is required to change the encryption vault',
      }
}

/**
 * Brute-force throttle for the password half of step-up. The key combines the
 * session hash with the client key so one stolen session (or one IP when the
 * proxy is trusted) cannot hammer password verification.
 */
function stepUpLimitKey(
  cookieHeader: string | null | undefined,
  clientKey: string | undefined
): string {
  const session = sessionHash(cookieHeader) ?? 'no-session'
  return rateLimitKey('step-up', `${session}:${clientKey ?? 'instance'}`)
}

/**
 * Extra proof beyond the sliding session cookie for actions that mint durable
 * credentials or reveal/mutate encryption material.
 *
 * - A freshly verified WebAuthn assertion yields a short-lived, one-use token
 *   bound to the current session cookie.
 * - Instances with an app password may instead verify `currentPassword`.
 * - Unlocked instance (no password, no passkeys): session gate only.
 *
 * `requireVaultStepUp` keeps the original vault wording; callers that gate API
 * tokens or passkeys pass `purpose: 'credentials'`.
 */
export async function requireSensitiveStepUp(
  input: VaultStepUpInput,
  cookieHeader?: string | null,
  options?: StepUpOptions
): Promise<void> {
  const purpose = options?.purpose ?? 'vault'
  const messages = messagesFor(purpose)

  if (input.stepUpToken) {
    if (consumeVaultStepUpToken(input.stepUpToken, cookieHeader)) return
    throw new VaultStepUpError(messages.tokenInvalid, 401)
  }

  const passwordHash = await getPasswordHash()
  if (passwordHash) {
    const currentPassword = input.currentPassword ?? ''
    if (!currentPassword) {
      throw new VaultStepUpError(messages.required, 403)
    }

    const limitKey = stepUpLimitKey(cookieHeader, options?.clientKey)
    const limited = assertNotRateLimited(limitKey)
    if (!limited.ok) {
      throw new VaultStepUpError(
        'Too many attempts. Try again shortly.',
        429,
        limited.retryAfterSec
      )
    }

    const valid = await verifyPassword(currentPassword, passwordHash)
    if (!valid) {
      recordAuthFailure(limitKey)
      throw new VaultStepUpError(messages.incorrect, 401)
    }
    recordAuthSuccess(limitKey)
    return
  }

  const { countPasskeys } = await import('@/lib/auth/webauthn')
  if ((await countPasskeys()) > 0) {
    throw new VaultStepUpError(messages.passkeyRequired, 403)
  }
}

export async function requireVaultStepUp(
  input: VaultStepUpInput,
  cookieHeader?: string | null,
  options?: StepUpOptions
): Promise<void> {
  return requireSensitiveStepUp(input, cookieHeader, {
    ...options,
    purpose: 'vault',
  })
}

/** Step-up for API-token minting and new passkey registration. */
export async function requireCredentialStepUp(
  input: VaultStepUpInput,
  cookieHeader?: string | null,
  request?: { headers: Headers }
): Promise<void> {
  return requireSensitiveStepUp(input, cookieHeader, {
    purpose: 'credentials',
    clientKey: request ? clientKeyFromRequest(request) : undefined,
  })
}
