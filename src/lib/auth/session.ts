import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
} from './constants'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  )
  return toBase64Url(new Uint8Array(signature))
}

async function verifySignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> {
  const key = await importHmacKey(secret)
  const sigBytes = fromBase64Url(signature)
  return crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(payload)
  )
}

export type SessionVerifyResult =
  | { ok: true; exp: number; epoch: number }
  | { ok: false }

/** Create a signed session token: `exp.epoch.HMAC(secret, exp.epoch)` */
export async function createSessionToken(
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
  epoch = 0
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds
  const payload = `${exp}.${epoch}`
  const signature = await signPayload(secret, payload)
  return `${payload}.${signature}`
}

/**
 * Verify a session token against the current session epoch.
 * Legacy `exp.sig` tokens are treated as epoch 0 so AUTH_SECRET upgrades
 * stay valid until a password change or explicit global revocation bumps the epoch.
 */
export async function inspectSessionToken(
  secret: string,
  token: string | undefined | null,
  epoch = 0
): Promise<SessionVerifyResult> {
  if (!token) return { ok: false }

  const parts = token.split('.')
  let expStr: string
  let tokenEpoch: number
  let signature: string
  let payload: string

  if (parts.length === 2) {
    ;[expStr, signature] = parts
    tokenEpoch = 0
    payload = expStr
  } else if (parts.length === 3) {
    const epochStr = parts[1]
    ;[expStr, , signature] = parts
    tokenEpoch = Number(epochStr)
    payload = `${expStr}.${epochStr}`
  } else {
    return { ok: false }
  }

  if (!expStr || !signature || !Number.isFinite(tokenEpoch)) {
    return { ok: false }
  }
  if (tokenEpoch !== epoch) {
    return { ok: false }
  }

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return { ok: false }
  }

  try {
    const valid = await verifySignature(secret, payload, signature)
    if (!valid) return { ok: false }
    return { ok: true, exp, epoch: tokenEpoch }
  } catch {
    return { ok: false }
  }
}

/** Verify a session token. Returns true if valid, not expired, and epoch matches. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined | null,
  epoch = 0
): Promise<boolean> {
  return (await inspectSessionToken(secret, token, epoch)).ok
}

/** True when a valid token is old enough to slide the 30-day window. */
export function sessionNeedsRefresh(
  exp: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const remaining = exp - nowSeconds
  if (remaining <= 0) return false
  const refreshWhenRemainingBelow =
    SESSION_MAX_AGE_SECONDS - SESSION_REFRESH_AFTER_SECONDS
  return remaining <= refreshWhenRemainingBelow
}

/**
 * Cookie flags for the session.
 * Default Secure=false so self-hosted LAN installs over http:// keep working;
 * browsers silently drop Secure cookies on non-HTTPS. Set AUTH_COOKIE_SECURE=true
 * when serving behind HTTPS.
 */
export function sessionCookieSecure(): boolean {
  return process.env.AUTH_COOKIE_SECURE === 'true'
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  }
}

/** Invalid encoding is treated as missing (unauthenticated), never thrown. */
export function parseCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join('='))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, SESSION_REFRESH_AFTER_SECONDS }
