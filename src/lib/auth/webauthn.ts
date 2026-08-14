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
import { webauthnCredentials } from '@/lib/db/schema'
import {
  saveWebauthnChallenge,
  takeWebauthnChallenge,
} from './webauthn-helpers'

export {
  canDeletePasskey,
  resetWebauthnChallenges,
  saveWebauthnChallenge,
  takeWebauthnChallenge,
  webauthnRpFromRequest,
} from './webauthn-helpers'

const RP_NAME = 'LazyBackup'
/** Stable user handle for single-operator instance */
const USER_ID = new TextEncoder().encode('lazybackup-operator')
const USER_NAME = 'operator'
const USER_DISPLAY = 'LazyBackup operator'

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
    userID: new Uint8Array(USER_ID),
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
  saveWebauthnChallenge('register', options.challenge)
  return options
}

export async function verifyAndStoreRegistration(options: {
  response: RegistrationResponseJSON
  expectedOrigin: string
  expectedRPID: string
  name?: string
}): Promise<PublicPasskey> {
  const expectedChallenge = takeWebauthnChallenge(
    'register',
    options.response.response.clientDataJSON
  )
  if (!expectedChallenge) {
    throw new Error('Registration challenge expired — try again')
  }

  const verification = await verifyRegistrationResponse({
    response: options.response,
    expectedChallenge,
    expectedOrigin: options.expectedOrigin,
    expectedRPID: options.expectedRPID,
    // Generate uses UV 'preferred'; keep verify false so existing passkeys still work.
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

export async function getAuthenticationOptions(
  rpID: string,
  kind: 'login' | 'step-up' = 'login'
) {
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
    userVerification: kind === 'step-up' ? 'required' : 'preferred',
  })
  saveWebauthnChallenge(kind, options.challenge)
  return options
}

export async function verifyAuthentication(options: {
  response: AuthenticationResponseJSON
  expectedOrigin: string
  expectedRPID: string
  kind?: 'login' | 'step-up'
}): Promise<boolean> {
  const kind = options.kind ?? 'login'
  const expectedChallenge = takeWebauthnChallenge(
    kind,
    options.response.response.clientDataJSON
  )
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
    requireUserVerification: kind === 'step-up',
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
