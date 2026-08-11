import { resourceInUseFromResponse } from "@/lib/api/resource-in-use"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
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
  usedByBackups?: Array<{
    id: string
    name: string
    roles: Array<"source" | "destination">
  }>
}

// Query keys
export const serverKeys = {
  all: ['servers'] as const,
  lists: () => [...serverKeys.all, 'list'] as const,
  list: (filters: string) => [...serverKeys.lists(), { filters }] as const,
  details: () => [...serverKeys.all, 'detail'] as const,
  detail: (id: string) => [...serverKeys.details(), id] as const,
  dockerVolumes: (id: string) => [...serverKeys.detail(id), 'docker-volumes'] as const,
  dockerContainers: (id: string) => [...serverKeys.detail(id), 'docker-containers'] as const,
  containerDbHints: (id: string, name: string) =>
    [...serverKeys.detail(id), 'docker-containers', name, 'db-hints'] as const,
}

export type ContainerDatabaseHints = {
  container: string
  engine?: 'postgres' | 'mysql' | 'mariadb'
  user?: string
  password?: string
  database?: string
  port?: number
  image?: string
  found: boolean
}

/** List named Docker volumes on a remote server */
export function useServerDockerVolumes(serverId: string) {
  return useQuery({
    queryKey: serverKeys.dockerVolumes(serverId),
    queryFn: async () => {
      const response = await fetch(`/api/servers/${serverId}/docker/volumes`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to list Docker volumes')
      }

      return data.volumes as string[]
    },
    enabled: !!serverId,
    retry: false,
  })
}

/** List running Docker container names on a remote server */
export function useServerDockerContainers(serverId: string, enabled = true) {
  return useQuery({
    queryKey: serverKeys.dockerContainers(serverId),
    queryFn: async () => {
      const response = await fetch(`/api/servers/${serverId}/docker/containers`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to list Docker containers')
      }

      return data.containers as string[]
    },
    enabled: !!serverId && enabled,
    retry: false,
  })
}

/** Fetch DB connection hints from docker inspect for a container */
export async function fetchContainerDbHints(
  serverId: string,
  containerName: string
): Promise<ContainerDatabaseHints> {
  const response = await fetch(
    `/api/servers/${serverId}/docker/containers/${encodeURIComponent(containerName)}/db-hints`
  )
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to inspect container')
  }

  return data.hints as ContainerDatabaseHints
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

/** SSH plus transport probe: prefers rsync on remote, else local scp — GET /api/servers/:id/test */
export function useTestServer(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'test'],
    queryFn: async () => {
      const response = await fetch(`/api/servers/${id}/test`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to test server")
      }

      return data as {
        success: boolean;
        rsyncAvailable: boolean;
        scpAvailable: boolean;
        dockerAvailable?: boolean;
        message?: string;
      }
    },
    enabled: false,
  })
}

// Test server connection and backup capabilities from form data (before the server is created)
export function useTestNewServerBackupCapabilities() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<{
    success: boolean;
    rsyncAvailable: boolean;
    scpAvailable: boolean;
    dockerAvailable?: boolean;
    message?: string;
  } | null>(null)

  const testServer = async (serverData: {
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'key';
    password?: string;
    privateKey?: string;
    sshKeyId?: string;
    systemKeyPath?: string;
  }) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/servers/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serverData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to test server connection")
      }

      setResult(data)
      return data
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  return {
    testServer,
    isLoading,
    error,
    result,
  }
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
        const body = (await response.json().catch(() => null)) as {
          error?: string
          backups?: Array<{ id: string; name: string; roles?: string[] }>
        } | null

        const inUse = resourceInUseFromResponse(
          response.status,
          body,
          "Server is used by backups"
        )
        if (inUse) throw inUse

        throw new Error(body?.error || "Failed to delete server")
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() })
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(id) })
      toast.success("Server deleted successfully")
    },
    onError: (error) => {
      console.error("Error deleting server:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete server")
    }
  })
} 
