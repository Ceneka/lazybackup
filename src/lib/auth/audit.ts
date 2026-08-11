import { db } from '@/lib/db'
import { auditLog } from '@/lib/db/schema'
import { nanoid } from 'nanoid'

export type AuditActor = {
  tokenId?: string | null
  tokenName?: string | null
}

/**
 * Append an audit row. Never pass secrets (tokens, passwords, keys) in detail.
 */
export async function writeAuditLog(
  actor: AuditActor | null | undefined,
  action: string,
  options?: { detail?: string; ok?: boolean }
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: nanoid(),
      tokenId: actor?.tokenId ?? null,
      tokenName: actor?.tokenName ?? null,
      action,
      detail: options?.detail?.slice(0, 2000) ?? null,
      ok: options?.ok ?? true,
      createdAt: new Date(),
    })
  } catch (error) {
    console.error('Failed to write audit log:', error)
  }
}
