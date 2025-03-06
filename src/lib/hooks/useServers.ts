import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: "password" | "key"
  password?: string
  privateKey?: string
  createdAt: string
  updatedAt: string
}

// Query keys
export const serverKeys = {
  all: ['servers'] as const,
  lists: () => [...serverKeys.all, 'list'] as const,
  list: (filters: string) => [...serverKeys.lists(), { filters }] as const,
  details: () => [...serverKeys.all, 'detail'] as const,
  detail: (id: string) => [...serverKeys.details(), id] as const,
}

// Fetch all servers
export function useServers() {
  return useQuery({
    queryKey: serverKeys.lists(),
    queryFn: async () => {
      const response = await fetch('/api/servers')
      
      if (!response.ok) {
        throw new Error(`Failed to fetch servers: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (!Array.isArray(data)) {
        throw new Error("Received invalid data format from server")
      }
      
      return data as Server[]
    }
  })
}

// Fetch a single server
export function useServer(id: string) {
  return useQuery({
    queryKey: serverKeys.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/servers/${id}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Server not found")
        }
        throw new Error("Failed to fetch server")
      }
      
      const data = await response.json()
      return data as Server
    },
    enabled: !!id
  })
}

// Test server connection
export function useTestServerConnection(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'test'],
    queryFn: async () => {
      const response = await fetch(`/api/servers/${id}/test`)
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to test connection")
      }
      
      return data as { success: boolean; message?: string }
    },
    enabled: false // This query won't run automatically
  })
}

// Delete a server
export function useDeleteServer() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/servers/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete server")
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() })
      toast.success("Server deleted successfully")
    },
    onError: (error) => {
      console.error("Error deleting server:", error)
      toast.error("Failed to delete server")
    }
  })
} 
