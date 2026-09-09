import { resourceInUseFromResponse } from "@/lib/api/resource-in-use"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export interface GitRepo {
  id: string
  name: string
  url: string
  sshKeyId: string | null
  createdAt: string
  updatedAt: string
  sshKey?: { id: string; name: string } | null
  usedByBackups?: Array<{
    id: string
    name: string
    roles: Array<"source" | "destination">
  }>
}

export type GitRepoInput = {
  name: string
  url: string
  sshKeyId: string | null
}

export const gitRepoKeys = {
  all: ["gitRepos"] as const,
  lists: () => [...gitRepoKeys.all, "list"] as const,
  detail: (id: string) => [...gitRepoKeys.all, "detail", id] as const,
}

export function useGitRepos() {
  return useQuery({
    queryKey: gitRepoKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/git-repos")
      if (!response.ok) {
        throw new Error(`Failed to fetch Git repositories: ${response.status}`)
      }
      const data = await response.json()
      if (!Array.isArray(data)) {
        throw new Error("Received invalid data format from server")
      }
      return data as GitRepo[]
    },
  })
}

export function useGitRepo(id: string) {
  return useQuery({
    queryKey: gitRepoKeys.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/git-repos/${id}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error("Git repository not found")
        throw new Error("Failed to fetch Git repository")
      }
      return (await response.json()) as GitRepo
    },
    enabled: !!id,
  })
}

export function useDeleteGitRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/git-repos/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
          backups?: Array<{ id: string; name: string; roles?: string[] }>
        } | null
        const inUse = resourceInUseFromResponse(
          response.status,
          body,
          "Git repository is used by backups"
        )
        if (inUse) throw inUse
        throw new Error(body?.error || "Failed to delete Git repository")
      }
      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: gitRepoKeys.lists() })
      queryClient.invalidateQueries({ queryKey: gitRepoKeys.detail(id) })
      toast.success("Git repository deleted")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete Git repository")
    },
  })
}

export async function testGitRepoConnection(data: GitRepoInput) {
  const response = await fetch("/api/git-repos/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error || "Git connection failed")
  }
  return body as { success: boolean; message?: string; refCount?: number }
}
