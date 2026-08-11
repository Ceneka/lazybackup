import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { apiTokens } from '@/lib/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  parseApiTokenPermissions,
  serializeApiTokenPermissions,
  type ApiTokenPermission,
} from './permissions'

const TOKEN_PREFIX = 'lb_'
const TOKEN_BYTES = 32

export type ApiTokenRecord = typeof apiTokens.$inferSelect

export type PublicApiToken = {
  id: string
  name: string
  tokenPrefix: string
  permissions: ApiTokenPermission[]
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

function toPublic(row: ApiTokenRecord): PublicApiToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    permissions: parseApiTokenPermissions(row.permissions),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  }
}

/** SHA-256 of plaintext — enough for high-entropy random tokens. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Generate a new API token. Returns plaintext once; only the hash is stored.
 * Format: `lb_<hex>`
 */
export async function createApiToken(
  name: string,
  permissions: readonly ApiTokenPermission[] = []
): Promise<{
  token: PublicApiToken
  plaintext: string
}> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Token name is required')
  }

  const plaintext = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`
  const id = nanoid()
  const now = new Date()

  const row: ApiTokenRecord = {
    id,
    name: trimmed,
    tokenHash: hashApiToken(plaintext),
    tokenPrefix: `${plaintext.slice(0, 11)}…`,
    permissions: serializeApiTokenPermissions(permissions),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  }

  await db.insert(apiTokens).values(row)

  return { token: toPublic(row), plaintext }
}

export async function listApiTokens(includeRevoked = false): Promise<PublicApiToken[]> {
  const rows = includeRevoked
    ? await db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt))
    : await db
        .select()
        .from(apiTokens)
        .where(isNull(apiTokens.revokedAt))
        .orderBy(desc(apiTokens.createdAt))

  return rows.map(toPublic)
}

export async function revokeApiToken(id: string): Promise<PublicApiToken | null> {
  const existing = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.id, id),
  })
  if (!existing || existing.revokedAt) return null

  const revokedAt = new Date()
  await db.update(apiTokens).set({ revokedAt }).where(eq(apiTokens.id, id))
  return toPublic({ ...existing, revokedAt })
}

export type VerifiedApiToken = {
  id: string
  name: string
  permissions: ApiTokenPermission[]
}

/**
 * Verify a Bearer token against active (non-revoked) hashes.
 * Updates lastUsedAt on success.
 */
export async function verifyApiToken(
  plaintext: string | null | undefined
): Promise<VerifiedApiToken | null> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null

  const tokenHash = hashApiToken(plaintext)
  const row = await db.query.apiTokens.findFirst({
    where: and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)),
  })
  if (!row) return null

  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => undefined)

  return {
    id: row.id,
    name: row.name,
    permissions: parseApiTokenPermissions(row.permissions),
  }
}

export function parseBearerToken(
  authorizationHeader: string | null | undefined
): string | undefined {
  if (!authorizationHeader) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  return match?.[1]?.trim() || undefined
}
