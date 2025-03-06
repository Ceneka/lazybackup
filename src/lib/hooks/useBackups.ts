import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface Backup {
  id: string
  serverId: string
  name: string
  sourcePath: string
  destinationPath: string
  schedule: string
  excludePatterns?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

// Query keys
export const backupKeys = {
  all: ['backups'] as const,
  lists: () => [...backupKeys.all, 'list'] as const,
  list: (filters: string) => [...backupKeys.lists(), { filters }] as const,
  details: () => [...backupKeys.all, 'detail'] as const,
  detail: (id: string) => [...backupKeys.details(), id] as const,
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
        throw new Error("Failed to delete backup")
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
      toast.success("Backup deleted successfully")
    },
    onError: (error) => {
      console.error("Error deleting backup:", error)
      toast.error("Failed to delete backup")
    }
  })
} 
