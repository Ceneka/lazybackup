import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export type EncryptionStatus = {
  configured: boolean
  recipient: string | null
}

export type EncryptionKeyResult = EncryptionStatus & {
  identity: string
}

export const encryptionKeys = {
  all: ["encryption"] as const,
}

async function fetchStatus(): Promise<EncryptionStatus> {
  const res = await fetch("/api/encryption")
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || "Failed to load encryption status")
  }
  return res.json()
}

export function useEncryption() {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: encryptionKeys.all,
    queryFn: fetchStatus,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: encryptionKeys.all })

  const generate = useMutation({
    mutationFn: async (): Promise<EncryptionKeyResult> => {
      const res = await fetch("/api/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to generate key")
      }
      return res.json()
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const importKey = useMutation({
    mutationFn: async (identity: string): Promise<EncryptionKeyResult> => {
      const res = await fetch("/api/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", identity }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to import key")
      }
      return res.json()
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const reveal = useMutation({
    mutationFn: async (): Promise<EncryptionKeyResult> => {
      const res = await fetch("/api/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to export key")
      }
      return res.json()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const clear = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to clear key")
      }
      return res.json()
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    generate,
    importKey,
    reveal,
    clear,
  }
}
