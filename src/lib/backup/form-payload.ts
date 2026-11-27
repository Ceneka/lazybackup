import type { EndpointKind } from "@/lib/backup/destination"

export type SourceKind = EndpointKind | "git"

export type BackupFormData = {
  name: string
  sourceKind: SourceKind
  serverId: string
  sourceS3ProfileId: string
  sourceGitRepoId: string
  destinationKind: EndpointKind
  destinationServerId: string
  destinationS3ProfileId: string
  destinationPeerId: string
  sourceType: "path" | "docker_volume" | "database" | "lazybackup_instance" | "git_repo"
  sourcePath: string
  destinationPath: string
  schedule: string
  excludePatterns: string
  preBackupCommands: string
  dbEngine: "postgres" | "mysql" | "mariadb" | "sqlite"
  dbClient: "native" | "docker"
  dbContainer: string
  dbHost: string
  dbPort: string
  dbUser: string
  dbPassword: string
  /** Edit only: a password is already stored (API never returns it) */
  hasDbPassword?: boolean
  instanceBackupPassphrase: string
  hasInstanceBackupPassphrase?: boolean
  enabled: boolean
  enableEncryption: boolean
  deleteExtraneous: boolean
  enableVersioning: boolean
  versionsToKeep: number
  enableFileRetention: boolean
  retentionMaxAge: number
  retentionMaxAgeUnit: "days" | "months"
  retentionMinKeep: number
}

export function formDataToPayload(data: BackupFormData) {
  const excludePatterns = data.excludePatterns.trim()
  const preBackupCommands = data.preBackupCommands.trim()

  return {
    name: data.name,
    sourceKind: data.sourceKind,
    serverId: data.sourceKind === "server" ? data.serverId : null,
    sourceS3ProfileId: data.sourceKind === "s3" ? data.sourceS3ProfileId : null,
    sourceGitRepoId: data.sourceKind === "git" ? data.sourceGitRepoId : null,
    destinationKind: data.destinationKind,
    destinationServerId: data.destinationKind === "server" ? data.destinationServerId : null,
    destinationS3ProfileId:
      data.destinationKind === "s3" ? data.destinationS3ProfileId : null,
    destinationPeerId: data.destinationKind === "peer" ? data.destinationPeerId : null,
    sourceType: data.sourceType,
    sourcePath:
      data.sourceType === "lazybackup_instance"
        ? "lazybackup-instance"
        : data.sourceType === "git_repo"
          ? "git-mirror"
          : data.sourcePath,
    destinationPath: data.destinationPath,
    schedule: data.schedule,
    excludePatterns:
      data.sourceType === "lazybackup_instance" || data.sourceType === "git_repo"
        ? null
        : data.sourceType === "database"
          ? undefined
          : excludePatterns || null,
    preBackupCommands:
      data.sourceType === "lazybackup_instance"
        ? null
        : data.sourceKind === "s3" || data.sourceKind === "git"
          ? undefined
          : preBackupCommands || null,
    dbEngine: data.sourceType === "database" ? data.dbEngine : null,
    dbClient: data.sourceType === "database" ? data.dbClient : null,
    dbContainer:
      data.sourceType === "database" && data.dbClient === "docker"
        ? data.dbContainer
        : null,
    dbHost: data.sourceType === "database" ? data.dbHost || "127.0.0.1" : null,
    dbPort:
      data.sourceType === "database" && data.dbPort
        ? Number(data.dbPort)
        : null,
    dbUser: data.sourceType === "database" ? data.dbUser : null,
    dbPassword: data.sourceType === "database" ? data.dbPassword : null,
    instanceBackupPassphrase:
      data.sourceType === "lazybackup_instance"
        ? data.instanceBackupPassphrase.trim()
          ? data.instanceBackupPassphrase
          : data.hasInstanceBackupPassphrase
            ? undefined
            : null
        : null,
    enabled: data.enabled,
    enableEncryption:
      data.sourceType === "lazybackup_instance"
        ? false
        : data.destinationKind === "peer"
          ? true
          : data.enableEncryption,
    deleteExtraneous:
      data.sourceType === "path" &&
      data.sourceKind !== "s3" &&
      data.sourceKind !== "git" &&
      data.destinationKind !== "s3" &&
      data.destinationKind !== "peer" &&
      !data.enableEncryption &&
      data.deleteExtraneous,
    enableVersioning: data.destinationKind === "peer" ? true : data.enableVersioning,
    versionsToKeep: data.versionsToKeep,
    enableFileRetention: data.destinationKind === "peer" ? false : data.enableFileRetention,
    retentionMaxAge: data.retentionMaxAge,
    retentionMaxAgeUnit: data.retentionMaxAgeUnit,
    retentionMinKeep: data.retentionMinKeep,
  }
}
