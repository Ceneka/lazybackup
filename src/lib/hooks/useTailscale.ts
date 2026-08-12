import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { peerKeys } from "./usePeers"

export type TailscaleStatusResponse = {
  available: boolean
  via: "socket" | "cli" | "none"
  cliAvailable: boolean
  backendState: string | null
  dnsName: string | null
  ipv4: string | null
  ipv6: string | null
  suggestedBaseUrl: string | null
  hint: string | null
  instanceBaseUrl: string | null
}

export const tailscaleKeys = {
  all: ["tailscale"] as const,
}

async function fetchTailscale(): Promise<TailscaleStatusResponse> {
  const res = await fetch("/api/peers/tailscale")
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || "Failed to read Tailscale")
  }
  return res.json()
}

export function useTailscale() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: tailscaleKeys.all,
    queryFn: fetchTailscale,
    refetchInterval: 15_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: tailscaleKeys.all })
    void queryClient.invalidateQueries({ queryKey: peerKeys.all })
  }

  const useSuggestedUrl = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/peers/tailscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "useSuggestedUrl" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to set URL")
      }
      return res.json() as Promise<{ instanceBaseUrl: string }>
    },
    onSuccess: (data) => {
      invalidate()
      toast.success(`Instance URL set to ${data.instanceBaseUrl}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const join = useMutation({
    mutationFn: async (authKey: string) => {
      const res = await fetch("/api/peers/tailscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", authKey, setInstanceUrl: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Join failed")
      }
      return res.json() as Promise<{
        message: string
        instanceBaseUrl?: string | null
      }>
    },
    onSuccess: (data) => {
      invalidate()
      toast.success(data.message)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return {
    ...query,
    useSuggestedUrl,
    join,
  }
}
