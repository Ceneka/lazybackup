import { cookies } from 'next/headers'
import {
  parseBearerToken,
  verifyApiToken,
  type VerifiedApiToken,
} from './api-tokens'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  inspectSessionToken,
  parseCookieValue,
  sessionCookieOptions,
  sessionNeedsRefresh,
  verifySessionToken,
} from './session'
import {
  getPasswordHash,
  getSessionEpoch,
  getSessionSecret,
  isAuthSetupCompleted,
} from './settings'

export {
  APP_PASSWORD_HASH_KEY,
  AUTH_SETUP_COMPLETED_KEY,
  SESSION_EPOCH_KEY,
  SESSION_SECRET_KEY,
  SENSITIVE_SETTING_KEYS,
  BEARER_REDACTED_SETTING_KEYS,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  MIN_PASSWORD_LENGTH,
} from './constants'

export {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from './password'

export {
  createSessionToken,
  inspectSessionToken,
  parseCookieValue,
  sessionNeedsRefresh,
  verifySessionToken,
  sessionCookieOptions,
  clearSessionCookieOptions,
  sessionCookieSecure,
} from './session'

export { safeInternalPath } from './redirect'

export {
  getPasswordHash,
  setPasswordHash,
  clearPasswordHash,
  isAuthSetupCompleted,
  markAuthSetupCompleted,
  getSessionSecret,
  getSessionEpoch,
  bumpSessionEpoch,
  claimFirstPasswordHash,
} from './settings'

export {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
  parseBearerToken,
  type PublicApiToken,
  type VerifiedApiToken,
} from './api-tokens'

export {
  API_TOKEN_PERMISSIONS,
  REMOTE_EXEC_DENIED,
  RemoteExecPermissionError,
  allowsPasswordSet,
  assertCanSetPreBackupCommands,
  authAllowsRemoteExec,
  authHasPermission,
  normalizeApiTokenPermissionsInput,
  parseApiTokenPermissions,
  preBackupChangeRequiresRemoteExec,
  serializeApiTokenPermissions,
  type ApiTokenPermission,
  type AuthPermissionView,
} from './permissions'

export { writeAuditLog, type AuditActor } from './audit'

export async function isAuthEnabled(): Promise<boolean> {
  const hash = await getPasswordHash()
  if (hash) return true
  const { countPasskeys } = await import('./webauthn')
  return (await countPasskeys()) > 0
}

async function verifyCookieToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [secret, epoch] = await Promise.all([getSessionSecret(), getSessionEpoch()])
  return verifySessionToken(secret, token, epoch)
}

export async function getSessionFromCookies(
  cookieStore?: Awaited<ReturnType<typeof cookies>>
): Promise<boolean> {
  const store = cookieStore ?? (await cookies())
  const token = store.get(SESSION_COOKIE_NAME)?.value
  return verifyCookieToken(token)
}

/** Valid session cookie only (not Bearer). Used to manage API tokens. */
export async function isSessionAuthorized(
  cookieHeader?: string | null
): Promise<boolean> {
  const enabled = await isAuthEnabled()
  if (!enabled) return true

  if (cookieHeader !== undefined) {
    const token = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
    return verifyCookieToken(token)
  }

  return getSessionFromCookies()
}

/**
 * Cookie session on a locked instance. Unlocked first-run is not sufficient —
 * used to block token mint and passkey register as anonymous lock-out tools.
 */
export async function requireLockedBrowserSession(
  cookieHeader?: string | null
): Promise<boolean> {
  if (!(await isAuthEnabled())) return false
  return isSessionAuthorized(cookieHeader)
}

export type AuthResolution = {
  authorized: boolean
  /** Present when authenticated via API token */
  apiToken?: VerifiedApiToken
  via: 'unlocked' | 'session' | 'bearer' | 'none'
}

/**
 * Resolve auth from cookie and/or Authorization Bearer.
 * Prefer Bearer when both are present (machine clients).
 */
export async function resolveAuth(
  cookieHeader?: string | null,
  authorizationHeader?: string | null
): Promise<AuthResolution> {
  const enabled = await isAuthEnabled()
  if (!enabled) {
    return { authorized: true, via: 'unlocked' }
  }

  const bearer = parseBearerToken(authorizationHeader)
  if (bearer) {
    const apiToken = await verifyApiToken(bearer)
    if (apiToken) {
      return { authorized: true, apiToken, via: 'bearer' }
    }
  }

  if (cookieHeader !== undefined) {
    const token = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
    if (await verifyCookieToken(token)) {
      return { authorized: true, via: 'session' }
    }
    return { authorized: false, via: 'none' }
  }

  if (await getSessionFromCookies()) {
    return { authorized: true, via: 'session' }
  }
  return { authorized: false, via: 'none' }
}

/** Single gate: unlocked OR valid session OR valid Bearer API token. */
export async function isAuthorized(
  cookieHeader?: string | null,
  authorizationHeader?: string | null
): Promise<boolean> {
  const result = await resolveAuth(cookieHeader, authorizationHeader)
  return result.authorized
}

export async function getAuthStatus(
  cookieHeader?: string | null,
  authorizationHeader?: string | null
) {
  const authEnabled = await isAuthEnabled()
  const authSetupCompleted = await isAuthSetupCompleted()
  const authenticated = authEnabled
    ? await isAuthorized(cookieHeader, authorizationHeader)
    : true

  const { getPasswordHash } = await import('./settings')
  const { countPasskeys } = await import('./webauthn')
  const hasPassword = Boolean(await getPasswordHash())
  const passkeyCount = await countPasskeys()

  return {
    authEnabled,
    authSetupCompleted,
    authenticated,
    hasPassword,
    hasPasskeys: passkeyCount > 0,
    ...(authEnabled && authenticated ? { passkeyCount } : {}),
  }
}

export async function createSessionCookieValue(): Promise<string> {
  const [secret, epoch] = await Promise.all([getSessionSecret(), getSessionEpoch()])
  return createSessionToken(secret, SESSION_MAX_AGE_SECONDS, epoch)
}

type CookieSetter = {
  cookies: {
    set: (
      name: string,
      value: string,
      options: ReturnType<typeof sessionCookieOptions>
    ) => unknown
  }
}

/** Slide the session cookie only after SESSION_REFRESH_AFTER_SECONDS of age. */
export async function maybeRefreshSessionCookie(
  response: CookieSetter,
  cookieHeader: string | null
): Promise<void> {
  const token = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
  if (!token) return
  const [secret, epoch] = await Promise.all([getSessionSecret(), getSessionEpoch()])
  const inspected = await inspectSessionToken(secret, token, epoch)
  if (!inspected.ok || !sessionNeedsRefresh(inspected.exp)) return
  const next = await createSessionToken(secret, SESSION_MAX_AGE_SECONDS, epoch)
  response.cookies.set(SESSION_COOKIE_NAME, next, sessionCookieOptions())
}
