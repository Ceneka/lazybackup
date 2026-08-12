import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/lib/db'
import { settings, webauthnCredentials } from '@/lib/db/schema'

const CHALLENGE_REGISTER_KEY = 'webauthnChallengeRegister'
const CHALLENGE_LOGIN_KEY = 'webauthnChallengeLogin'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

const RP_NAME = 'LazyBackup'
/** Stable user handle for single-operator instance */
const USER_ID = new TextEncoder().encode('lazybackup-operator')
const USER_NAME = 'operator'
const USER_DISPLAY = 'LazyBackup operator'

type StoredChallenge = {
  challenge: string
  expiresAt: number
}

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  })
  return row?.value ?? null
}

async function setSettingValue(key: string, value: string): Promise<void> {
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  })
  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, key))
    return
  }
  await db.insert(settings).values({
    id: nanoid(),
    key,
    value,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function deleteSettingValue(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key))
}

async function saveChallenge(
  key: string,
  challenge: string
): Promise<void> {
  await setSettingValue(
    key,
    JSON.stringify({
      challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    } satisfies StoredChallenge)
  )
}

async function takeChallenge(key: string): Promise<string | null> {
  const raw = await getSettingValue(key)
  await deleteSettingValue(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredChallenge
    if (!parsed.challenge || Date.now() > parsed.expiresAt) return null
    return parsed.challenge
  } catch {
    return null
  }
}

export function webauthnRpFromRequest(request: {
  headers: Headers
  nextUrl?: { protocol: string; host: string }
}): { rpID: string; origin: string } {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const hostHeader = request.headers.get('host')?.trim()
  const host = forwardedHost || hostHeader || request.nextUrl?.host || 'localhost'
  const rpID = host.split(':')[0] || 'localhost'
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto =
    forwardedProto ||
    request.nextUrl?.protocol?.replace(':', '') ||
    (rpID === 'localhost' ? 'http' : 'https')
  return { rpID, origin: `${proto}://${host}` }
}

export type PublicPasskey = {
  id: string
  name: string
  credentialId: string
  createdAt: Date
  lastUsedAt: Date | null
}

export async function countPasskeys(): Promise<number> {
  const rows = await db.query.webauthnCredentials.findMany({
    columns: { id: true },
  })
  return rows.length
}

export async function listPasskeys(): Promise<PublicPasskey[]> {
  const rows = await db.query.webauthnCredentials.findMany({
    orderBy: [desc(webauthnCredentials.createdAt)],
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    credentialId: r.credentialId,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt ?? null,
  }))
}

export async function deletePasskey(id: string): Promise<void> {
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, id))
}

export async function getRegistrationOptions(rpID: string) {
  const existing = await db.query.webauthnCredentials.findMany()
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: USER_NAME,
    userDisplayName: USER_DISPLAY,
    userID: USER_ID,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })
  await saveChallenge(CHALLENGE_REGISTER_KEY, options.challenge)
  return options
}

export async function verifyAndStoreRegistration(options: {
  response: RegistrationResponseJSON
  expectedOrigin: string
  expectedRPID: string
  name?: string
}): Promise<PublicPasskey> {
  const expectedChallenge = await takeChallenge(CHALLENGE_REGISTER_KEY)
  if (!expectedChallenge) {
    throw new Error('Registration challenge expired — try again')
  }

  const verification = await verifyRegistrationResponse({
    response: options.response,
    expectedChallenge,
    expectedOrigin: options.expectedOrigin,
    expectedRPID: options.expectedRPID,
    requireUserVerification: false,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration failed verification')
  }

  const { credential } = verification.registrationInfo
  const id = nanoid()
  const name = options.name?.trim() || `Passkey ${new Date().toISOString().slice(0, 10)}`
  const transports = credential.transports ?? []

  await db.insert(webauthnCredentials).values({
    id,
    name,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: JSON.stringify(transports),
    createdAt: new Date(),
  })

  return {
    id,
    name,
    credentialId: credential.id,
    createdAt: new Date(),
    lastUsedAt: null,
  }
}

export async function getAuthenticationOptions(rpID: string) {
  const existing = await db.query.webauthnCredentials.findMany()
  if (existing.length === 0) {
    throw new Error('No passkeys registered')
  }
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    userVerification: 'preferred',
  })
  await saveChallenge(CHALLENGE_LOGIN_KEY, options.challenge)
  return options
}

export async function verifyAuthentication(options: {
  response: AuthenticationResponseJSON
  expectedOrigin: string
  expectedRPID: string
}): Promise<boolean> {
  const expectedChallenge = await takeChallenge(CHALLENGE_LOGIN_KEY)
  if (!expectedChallenge) {
    throw new Error('Login challenge expired — try again')
  }

  const credentialId = options.response.id
  const row = await db.query.webauthnCredentials.findFirst({
    where: eq(webauthnCredentials.credentialId, credentialId),
  })
  if (!row) {
    throw new Error('Unknown passkey')
  }

  const verification = await verifyAuthenticationResponse({
    response: options.response,
    expectedChallenge,
    expectedOrigin: options.expectedOrigin,
    expectedRPID: options.expectedRPID,
    requireUserVerification: false,
    credential: {
      id: row.credentialId,
      publicKey: isoBase64URL.toBuffer(row.publicKey),
      counter: row.counter,
      transports: parseTransports(row.transports),
    },
  })

  if (!verification.verified) {
    throw new Error('Passkey authentication failed')
  }

  const newCounter = verification.authenticationInfo.newCounter
  await db
    .update(webauthnCredentials)
    .set({
      counter: newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(webauthnCredentials.id, row.id))

  return true
}

function parseTransports(raw: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as AuthenticatorTransportFuture[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
