import { resourceInUseFromResponse } from "@/lib/api/resource-in-use"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export interface S3Profile {
  id: string
  name: string
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  /** Never returned by GET APIs — only sent on create/update */
  secretAccessKey?: string
  hasSecretAccessKey?: boolean
  forcePathStyle: boolean
  createdAt: string
  updatedAt: string
  usedByBackups?: Array<{
    id: string
    name: string
    roles: Array<"source" | "destination">
  }>
}

export type S3ProfileInput = {
  name: string
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export const s3ProfileKeys = {
  all: ["s3-profiles"] as const,
  lists: () => [...s3ProfileKeys.all, "list"] as const,
  detail: (id: string) => [...s3ProfileKeys.all, "detail", id] as const,
}

export function useS3Profiles() {
  return useQuery({
    queryKey: s3ProfileKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/s3-profiles")
      if (!response.ok) {
        throw new Error(`Failed to fetch S3 profiles: ${response.status}`)
      }
      const data = await response.json()
      if (!Array.isArray(data)) {
        throw new Error("Received invalid data format from server")
      }
      return data as S3Profile[]
    },
  })
}

export function useS3Profile(id: string) {
  return useQuery({
    queryKey: s3ProfileKeys.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/s3-profiles/${id}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error("S3 profile not found")
        throw new Error("Failed to fetch S3 profile")
      }
      return (await response.json()) as S3Profile
    },
    enabled: !!id,
  })
}

export function useDeleteS3Profile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/s3-profiles/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
          backups?: Array<{ id: string; name: string; roles?: string[] }>
        } | null
        const inUse = resourceInUseFromResponse(
          response.status,
          body,
          "S3 profile is used by backups"
        )
        if (inUse) throw inUse
        throw new Error(body?.error || "Failed to delete S3 profile")
      }
      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: s3ProfileKeys.lists() })
      queryClient.invalidateQueries({ queryKey: s3ProfileKeys.detail(id) })
      toast.success("S3 profile deleted")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete S3 profile")
    },
  })
}

export async function testS3ProfileConnection(data: S3ProfileInput) {
  const response = await fetch("/api/s3-profiles/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error || "S3 connection failed")
  }
  return body as { success: boolean; message?: string }
}
