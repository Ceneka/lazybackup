import { db } from '@/lib/db'
import { servers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const PATH_TRANSFER_NEEDS_KEY =
  'Path transfers require SSH key authentication on every server endpoint. Password auth still works for Test connection, listing volumes/containers, and database dumps.'

type ServerAuth = {
  id?: string | null
  name?: string | null
  authType: string
}

/** Path jobs that rsync/scp via a server endpoint need a key, not a password. */
export function pathJobUsesServerEndpoint(input: {
  sourceType?: string | null
  sourceKind?: string | null
  destinationKind?: string | null
}): boolean {
  const sourceType = input.sourceType || 'path'
  if (sourceType !== 'path') return false
  return input.sourceKind === 'server' || input.destinationKind === 'server'
}

export function passwordOnlyPathTransferError(
  serversToCheck: ServerAuth[]
): string | null {
  const bad = serversToCheck.filter((s) => s.authType === 'password')
  if (bad.length === 0) return null
  const names = bad.map((s) => s.name?.trim() || 'server').join(', ')
  return `Path transfers need an SSH key on ${names}. ${PATH_TRANSFER_NEEDS_KEY}`
}

export class TransferKeyRequiredError extends Error {
  readonly status = 400

  constructor(message: string = PATH_TRANSFER_NEEDS_KEY) {
    super(message)
    this.name = 'TransferKeyRequiredError'
  }
}

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
