import { db } from '@/lib/db'
import { servers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  passwordOnlyPathTransferError,
  pathJobUsesServerEndpoint,
  TransferKeyRequiredError,
  type ServerAuth,
} from './transfer-keys'

async function loadServer(id: string): Promise<ServerAuth | null> {
  const row = await db.query.servers.findFirst({
    where: eq(servers.id, id),
    columns: { id: true, name: true, authType: true },
  })
  return row ?? null
}

/**
 * Throws when a path backup would rsync/scp through a password-only server.
 * Database dumps, volume packs, and Test connection are not gated.
 */
export async function assertTransferServersHaveKeys(config: {
  sourceType?: string | null
  sourceKind?: string | null
  destinationKind?: string | null
  serverId?: string | null
  destinationServerId?: string | null
  server?: ServerAuth | null
  destinationServer?: ServerAuth | null
}): Promise<void> {
  if (!pathJobUsesServerEndpoint(config)) return

  const toCheck: ServerAuth[] = []

  if (config.sourceKind === 'server') {
    const source =
      config.server ??
      (config.serverId ? await loadServer(config.serverId) : null)
    if (source) toCheck.push(source)
  }

  if (config.destinationKind === 'server') {
    const dest =
      config.destinationServer ??
      (config.destinationServerId
        ? await loadServer(config.destinationServerId)
        : null)
    if (dest) toCheck.push(dest)
  }

  const message = passwordOnlyPathTransferError(toCheck)
  if (message) {
    throw new TransferKeyRequiredError(message)
  }
}
