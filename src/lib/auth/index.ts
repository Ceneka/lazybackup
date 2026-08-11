import { cookies } from 'next/headers'
import {
  parseBearerToken,
  verifyApiToken,
  type VerifiedApiToken,
} from './api-tokens'
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
} from './session'
import {
  getPasswordHash,
  getSessionSecret,
  isAuthSetupCompleted,
} from './settings'

export {
  APP_PASSWORD_HASH_KEY,
  AUTH_SETUP_COMPLETED_KEY,
  SESSION_SECRET_KEY,
  SENSITIVE_SETTING_KEYS,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  MIN_PASSWORD_LENGTH,
} from './constants'

export {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from './password'

export {
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  clearSessionCookieOptions,
  sessionCookieSecure,
} from './session'

export {
  getPasswordHash,
  setPasswordHash,
  clearPasswordHash,
  isAuthSetupCompleted,
  markAuthSetupCompleted,
  getSessionSecret,
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
  return Boolean(hash)
}

export async function getSessionFromCookies(
  cookieStore?: Awaited<ReturnType<typeof cookies>>
): Promise<boolean> {
  const store = cookieStore ?? (await cookies())
  const token = store.get(SESSION_COOKIE_NAME)?.value
  if (!token) return false

  const secret = await getSessionSecret()
  return verifySessionToken(secret, token)
}

/** Valid session cookie only (not Bearer). Used to manage API tokens. */
export async function isSessionAuthorized(
  cookieHeader?: string | null
): Promise<boolean> {
  const enabled = await isAuthEnabled()
  if (!enabled) return true

  if (cookieHeader !== undefined) {
    const token = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME)
    const secret = await getSessionSecret()
    return verifySessionToken(secret, token)
  }

  return getSessionFromCookies()
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
    const secret = await getSessionSecret()
    if (await verifySessionToken(secret, token)) {
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

  return { authEnabled, authSetupCompleted, authenticated }
}

export async function createSessionCookieValue(): Promise<string> {
  const secret = await getSessionSecret()
  return createSessionToken(secret)
}

export function parseCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return undefined
}
