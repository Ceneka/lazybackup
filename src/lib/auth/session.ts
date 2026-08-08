import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
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

/** Create a signed session token: `exp.signature` */
export async function createSessionToken(
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds
  const payload = String(exp)
  const signature = await signPayload(secret, payload)
  return `${payload}.${signature}`
}

/** Verify a session token. Returns true if valid and not expired. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined | null
): Promise<boolean> {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false

  const [payload, signature] = parts
  if (!payload || !signature) return false

  const exp = Number(payload)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return false
  }

  try {
    return await verifySignature(secret, payload, signature)
  } catch {
    return false
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS }
