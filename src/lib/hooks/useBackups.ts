import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface Backup {
  id: string
  sourceKind?: 'local' | 'server'
  serverId?: string | null
  destinationKind?: 'local' | 'server'
  destinationServerId?: string | null
  name: string
  sourceType?: 'path' | 'docker_volume'
  sourcePath: string
  destinationPath: string
  schedule: string
  scheduleLabel?: string
  timezone?: string
  nextRun?: string | null
  nextRunFormatted?: string | null
  excludePatterns?: string
  preBackupCommands?: string
  enabled: boolean
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
  createdAt: string
  updatedAt: string
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

// Update a backup
export function useUpdateBackup() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string, data: Partial<Backup> }) => {
      const response = await fetch(`/api/backups/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to update backup configuration')
      }

      return responseData
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: backupKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      toast.success('Backup configuration updated successfully')
    },
    onError: (error) => {
      console.error('Error updating backup configuration:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update backup configuration')
    }
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      toast.success("Backup deleted successfully")
    },
    onError: (error) => {
      console.error("Error deleting backup:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete backup")
    }
  })
}
