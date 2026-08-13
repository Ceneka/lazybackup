import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export type ValidateCheck = {
  id: string
  label: string
  status: "pass" | "fail" | "warn"
  message: string
}

export type LastValidation = {
  ok: boolean
  at: string
  checks: ValidateCheck[]
}

// Type definitions
export interface Backup {
  id: string
  sourceKind?: 'local' | 'server' | 's3'
  serverId?: string | null
  sourceS3ProfileId?: string | null
  destinationKind?: 'local' | 'server' | 's3' | 'peer'
  destinationServerId?: string | null
  destinationS3ProfileId?: string | null
  destinationPeerId?: string | null
  name: string
  sourceType?: 'path' | 'docker_volume' | 'database' | 'lazybackup_instance'
  sourcePath: string
  destinationPath: string
  schedule: string
  scheduleLabel?: string
  timezone?: string
  nextRun?: string | null
  nextRunFormatted?: string | null
  excludePatterns?: string
  preBackupCommands?: string
  dbEngine?: 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | null
  dbClient?: 'native' | 'docker' | null
  dbContainer?: string | null
  dbHost?: string | null
  dbPort?: number | null
  dbUser?: string | null
  dbPassword?: string | null
  hasDbPassword?: boolean
  instanceBackupPassphrase?: string | null
  hasInstanceBackupPassphrase?: boolean
  enabled: boolean
  enableEncryption?: boolean
  enableVersioning?: boolean
  versionsToKeep?: number
  enableFileRetention?: boolean
  retentionMaxAge?: number
  retentionMaxAgeUnit?: 'days' | 'months'
  retentionMinKeep?: number
  server?: {
    id?: string
    name: string
    host?: string
  } | null
  destinationServer?: {
    id?: string
    name: string
    host?: string
  } | null
  sourceS3Profile?: {
    id?: string
    name: string
    bucket?: string
    endpoint?: string
  } | null
  destinationS3Profile?: {
    id?: string
    name: string
    bucket?: string
    endpoint?: string
  } | null
  destinationPeer?: {
    id?: string
    name: string
    quotaBytes?: number
    usedBytes?: number
  } | null
  createdAt: string
  updatedAt: string
  lastValidation?: LastValidation | null
}

export interface BackupDestinationEntry {
  name: string
  type: 'file' | 'directory'
  bytes: number
  size: string
  fileCount: number
  directoryCount: number
  mtime: string
  isVersionDir: boolean
}

export interface BackupDestinationSummary {
  configuredPath: string
  path: string
  exists: boolean
  remote?: boolean
  remoteServerName?: string | null
  totalBytes: number
  totalSize: string
  fileCount: number
  directoryCount: number
  lastModified: string | null
  truncated: boolean
  versioning: {
    enabled: boolean
    versionsToKeep: number | null
    versionCount: number
    versions: BackupDestinationEntry[]
  }
  topLevel: BackupDestinationEntry[]
}

// Query keys
export const backupKeys = {
  all: ['backups'] as const,
  lists: () => [...backupKeys.all, 'list'] as const,
  list: (filters: string) => [...backupKeys.lists(), { filters }] as const,
  details: () => [...backupKeys.all, 'detail'] as const,
  detail: (id: string) => [...backupKeys.details(), id] as const,
  storage: (id: string) => [...backupKeys.detail(id), 'storage'] as const,
}

// Fetch all backups
export function useBackups() {
  return useQuery({
    queryKey: backupKeys.lists(),
    queryFn: async () => {
      const response = await fetch('/api/backups')
      
      if (!response.ok) {
        throw new Error(`Failed to fetch backups: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (!Array.isArray(data)) {
        throw new Error("Received invalid data format from server")
      }
      
      return data as Backup[]
    }
  })
}

// Fetch a single backup
export function useBackup(id: string) {
  return useQuery({
    queryKey: backupKeys.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/backups/${id}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Backup not found")
        }
        throw new Error("Failed to fetch backup")
      }
      
      const data = await response.json()
      return data as Backup
    },
    enabled: !!id
  })
}

export type ValidateBackupResult = {
  ok: boolean
  checks: ValidateCheck[]
  at?: string
}

export async function validateBackup(id: string): Promise<ValidateBackupResult> {
  const response = await fetch(`/api/backups/${id}/validate`, { method: "POST" })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error || "Failed to validate backup")
  }
  return body as ValidateBackupResult
}

// Summarize on-disk files at the backup destination
export function useBackupStorage(id: string) {
  return useQuery({
    queryKey: backupKeys.storage(id),
    queryFn: async () => {
      const response = await fetch(`/api/backups/${id}/storage`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Backup not found")
        }
        throw new Error("Failed to fetch backup storage summary")
      }

      return response.json() as Promise<BackupDestinationSummary>
    },
    enabled: !!id,
  })
}

// Delete a backup
export function useDeleteBackup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/backups/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error || "Failed to delete backup")
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      queryClient.invalidateQueries({ queryKey: backupKeys.detail(id) })
      toast.success("Backup deleted successfully")
    },
    onError: (error) => {
      console.error("Error deleting backup:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete backup")
    }
  })
}
