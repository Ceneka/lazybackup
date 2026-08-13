export type EndpointDisplayBackup = {
  sourceKind?: 'local' | 'server' | 's3' | null
  destinationKind?: 'local' | 'server' | 's3' | 'peer' | null
  sourceType?: 'path' | 'docker_volume' | 'database' | 'lazybackup_instance' | null
  sourcePath?: string | null
  destinationPath?: string | null
  dbEngine?: string | null
  server?: { name: string } | null
  destinationServer?: { name: string } | null
  sourceS3Profile?: { name: string } | null
  destinationS3Profile?: { name: string } | null
  destinationPeer?: { name: string } | null
}

export function sourceKindOf(
  backup: EndpointDisplayBackup
): 'local' | 'server' | 's3' {
  return backup.sourceKind || 'server'
}

export function destinationKindOf(
  backup: EndpointDisplayBackup
): 'local' | 'server' | 's3' | 'peer' {
  return backup.destinationKind || 'local'
}

export function sourceEndpointName(backup: EndpointDisplayBackup): string {
  const kind = sourceKindOf(backup)
  if (kind === 'local') return 'This host'
  if (kind === 's3') return backup.sourceS3Profile?.name || 'S3'
  return backup.server?.name || 'Unknown server'
}

export function destinationEndpointName(backup: EndpointDisplayBackup): string {
  const kind = destinationKindOf(backup)
  if (kind === 'local') return 'This host'
  if (kind === 's3') return backup.destinationS3Profile?.name || 'S3'
  if (kind === 'peer') return backup.destinationPeer?.name || 'Bro'
  return backup.destinationServer?.name || 'Unknown server'
}

export function sourcePathLabel(backup: EndpointDisplayBackup): string {
  const path = backup.sourcePath || ''
  if (backup.sourceType === 'docker_volume') return `volume ${path}`
  if (backup.sourceType === 'database') return `${backup.dbEngine || 'db'} ${path}`
  if (backup.sourceType === 'lazybackup_instance') return 'instance data'
  return path
}

export function sourceTypeLabel(backup: EndpointDisplayBackup): string {
  if (backup.sourceType === 'docker_volume') return 'Docker volume'
  if (backup.sourceType === 'database') {
    return `Database dump (${backup.dbEngine || 'unknown'})`
  }
  if (backup.sourceType === 'lazybackup_instance') return 'LazyBackup instance data'
  return 'Filesystem path'
}
