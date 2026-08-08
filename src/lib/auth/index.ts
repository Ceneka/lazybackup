import { cookies } from 'next/headers'
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

/** Single gate: unlocked OR valid session. */
export async function isAuthorized(
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

export async function getAuthStatus(cookieHeader?: string | null) {
  const authEnabled = await isAuthEnabled()
  const authSetupCompleted = await isAuthSetupCompleted()
  const authenticated = authEnabled
    ? await isAuthorized(cookieHeader)
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
