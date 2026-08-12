import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import {
  APP_PASSWORD_HASH_KEY,
  AUTH_SETUP_COMPLETED_KEY,
  SESSION_EPOCH_KEY,
  SESSION_SECRET_KEY,
} from './constants'

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  })
  return row?.value ?? null
}

async function setSettingValue(key: string, value: string | null): Promise<void> {
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

export async function getPasswordHash(): Promise<string | null> {
  const value = await getSettingValue(APP_PASSWORD_HASH_KEY)
  return value?.trim() || null
}

export async function setPasswordHash(hash: string): Promise<void> {
  await setSettingValue(APP_PASSWORD_HASH_KEY, hash)
}

export async function clearPasswordHash(): Promise<void> {
  await deleteSettingValue(APP_PASSWORD_HASH_KEY)
}

export async function isAuthSetupCompleted(): Promise<boolean> {
  const value = await getSettingValue(AUTH_SETUP_COMPLETED_KEY)
  return value === 'true'
}

export async function markAuthSetupCompleted(): Promise<void> {
  await setSettingValue(AUTH_SETUP_COMPLETED_KEY, 'true')
}

/**
 * Session signing secret: AUTH_SECRET env, else persisted random value in settings.
 */
export async function getSessionSecret(): Promise<string> {
  const fromEnv = process.env.AUTH_SECRET?.trim()
  if (fromEnv) return fromEnv

  const existing = await getSettingValue(SESSION_SECRET_KEY)
  if (existing?.trim()) return existing.trim()

  const generated = nanoid(48)
  await setSettingValue(SESSION_SECRET_KEY, generated)
  return generated
}

export async function getSessionEpoch(): Promise<number> {
  const value = await getSettingValue(SESSION_EPOCH_KEY)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Invalidate every signed session cookie. AUTH_SECRET itself is unchanged. */
export async function bumpSessionEpoch(): Promise<number> {
  const next = (await getSessionEpoch()) + 1
  await setSettingValue(SESSION_EPOCH_KEY, String(next))
  return next
}

async function upsertSettingInTx(
  tx: {
    select: typeof db.select
    update: typeof db.update
    insert: typeof db.insert
  },
  key: string,
  value: string,
  now: Date
): Promise<void> {
  const existing = await tx
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1)
  if (existing[0]) {
    await tx
      .update(settings)
      .set({ value, updatedAt: now })
      .where(eq(settings.key, key))
    return
  }
  await tx.insert(settings).values({
    id: nanoid(),
    key,
    value,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Compare-and-set the first app password inside a SQLite transaction so two
 * concurrent first-run setups cannot both believe they won.
 */
export async function claimFirstPasswordHash(
  hash: string
): Promise<'ok' | 'already_set'> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(settings)
      .where(eq(settings.key, APP_PASSWORD_HASH_KEY))
      .limit(1)
    if (rows[0]?.value?.trim()) {
      return 'already_set'
    }
    const now = new Date()
    await upsertSettingInTx(tx, APP_PASSWORD_HASH_KEY, hash, now)
    await upsertSettingInTx(tx, AUTH_SETUP_COMPLETED_KEY, 'true', now)
    return 'ok'
  })
}
