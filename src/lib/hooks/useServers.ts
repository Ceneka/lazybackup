import { ApiError, readApiError } from "@/lib/api/client-error"
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
  /** Present only on create/test payloads — never returned by GET APIs */
  password?: string
  privateKey?: string
  sshKeyId?: string | null
  systemKeyPath?: string | null
  sshKey?: { id: string; name: string } | null
  hasPassword?: boolean
  hasPrivateKey?: boolean
  createdAt: string
  updatedAt: string
  usedByBackups?: Array<{
    id: string
    name: string
    roles: Array<"source" | "destination">
  }>
}

/** Payload accepted by POST /api/servers/test and PUT /api/servers/:id. */
export type ServerTestPayload = {
  name?: string
  host: string
  port: number
  username: string
  authType: "password" | "key"
  password?: string
  privateKey?: string
  sshKeyId?: string
  systemKeyPath?: string
}

export type ServerTestResult = {
  success: boolean
  rsyncAvailable: boolean
  scpAvailable: boolean
  dockerAvailable?: boolean
  authType?: "password" | "key"
  message?: string
}

/** Probe the credentials currently in a form (POST /api/servers/test). */
export async function testServerFromForm(
  serverData: ServerTestPayload
): Promise<ServerTestResult> {
  const response = await fetch("/api/servers/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serverData),
  })

  if (!response.ok) {
    const { message, fieldErrors } = await readApiError(response)
    throw new ApiError(message, { status: response.status, fieldErrors })
  }

  return (await response.json()) as ServerTestResult
}

/** Probe the saved row (GET /api/servers/:id/test). */
export async function testStoredServer(id: string): Promise<ServerTestResult> {
  const response = await fetch(`/api/servers/${id}/test`)

  if (!response.ok) {
    const { message, fieldErrors } = await readApiError(response)
    throw new ApiError(message, { status: response.status, fieldErrors })
  }

  return (await response.json()) as ServerTestResult
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
  host?: string
  port?: number
  image?: string
  found: boolean
  hasPassword?: boolean
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

/** List named Docker volumes on this LazyBackup host */
export function useLocalDockerVolumes(enabled = true) {
  return useQuery({
    queryKey: ['docker', 'volumes'] as const,
    queryFn: async () => {
      const response = await fetch('/api/docker/volumes')
      const data = await response.json()

      if (!response.ok) {
        throw Object.assign(new Error(data.error || 'Failed to list Docker volumes'), {
          code: data.code as string | undefined,
        })
      }

      return data.volumes as string[]
    },
    enabled,
    retry: false,
  })
}

/** List running Docker container names on this LazyBackup host */
export function useLocalDockerContainers(enabled = true) {
  return useQuery({
    queryKey: ['docker', 'containers'] as const,
    queryFn: async () => {
      const response = await fetch('/api/docker/containers')
      const data = await response.json()

      if (!response.ok) {
        throw Object.assign(new Error(data.error || 'Failed to list Docker containers'), {
          code: data.code as string | undefined,
        })
      }

      return data.containers as string[]
    },
    enabled,
    retry: false,
  })
}

/** Fetch DB connection hints from docker inspect for a container */
export async function fetchContainerDbHints(
  serverId: string | 'local',
  containerName: string
): Promise<ContainerDatabaseHints> {
  const url =
    serverId === 'local'
      ? `/api/docker/containers/${encodeURIComponent(containerName)}/db-hints`
      : `/api/servers/${serverId}/docker/containers/${encodeURIComponent(containerName)}/db-hints`
  const response = await fetch(url)
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
        const { message } = await readApiError(response)
        throw new ApiError(message, { status: response.status })
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
        const { message } = await readApiError(response)
        throw new ApiError(message, { status: response.status })
      }

      return (await response.json()) as Server
    },
    enabled: !!id
  })
}

/** SSH plus transport probe: prefers rsync on remote, else local scp — GET /api/servers/:id/test */
export function useTestServer(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'test'],
    queryFn: () => testStoredServer(id),
    enabled: false,
  })
}

// Test server connection and backup capabilities from form data (before the server is created)
export function useTestNewServerBackupCapabilities() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<
    (ServerTestResult & { testedAt?: number; testedLabel?: string }) | null
  >(null)

  const testServer = async (serverData: ServerTestPayload) => {
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await testServerFromForm(serverData)
      const withMeta = {
        ...data,
        testedAt: Date.now(),
        testedLabel: `Current form values · ${serverData.username}@${serverData.host}:${serverData.port}`,
      }
      setResult(withMeta)
      return withMeta
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(err instanceof Error ? err : new Error(message))
      setResult({
        success: false,
        rsyncAvailable: false,
        scpAvailable: false,
        dockerAvailable: false,
        authType: serverData.authType,
        message,
        testedAt: Date.now(),
        testedLabel: `Current form values · ${serverData.username}@${serverData.host}:${serverData.port}`,
      })
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  const resetResult = () => {
    setResult(null)
    setError(null)
  }

  return {
    testServer,
    isLoading,
    error,
    result,
    resetResult,
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
