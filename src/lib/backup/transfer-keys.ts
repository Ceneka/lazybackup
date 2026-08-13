export const PATH_TRANSFER_NEEDS_KEY =
  'Path transfers require SSH key authentication on every server endpoint. Password auth still works for Test connection, listing volumes/containers, and database dumps.'

export type ServerAuth = {
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
