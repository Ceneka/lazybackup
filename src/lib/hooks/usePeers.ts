import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export type PeerSummary = {
  id: string
  name: string
  remoteBaseUrl: string
  remotePeerId: string | null
  quotaBytes: number
  quotaGb: number
  usedBytes: number
  status: string
  inboundTokenPrefix: string
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}

export type PeerInviteSummary = {
  id: string
  code: string
  label: string
  quotaBytes: number
  quotaGb: number
  status: string
  expiresAt: string
  createdAt: string
  localBaseUrl: string
}

export type PeersResponse = {
  instanceBaseUrl: string | null
  peers: PeerSummary[]
  invites: PeerInviteSummary[]
}

export const peerKeys = {
  all: ["peers"] as const,
}

async function fetchPeers(): Promise<PeersResponse> {
  const res = await fetch("/api/peers")
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || "Failed to load Bro Space")
  }
  return res.json()
}

export function usePeers() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: peerKeys.all,
    queryFn: fetchPeers,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: peerKeys.all })

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/peers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || "Request failed")
    }
    return res.json()
  }

  const setBaseUrl = useMutation({
    mutationFn: (baseUrl: string) => post({ action: "setBaseUrl", baseUrl }),
    onSuccess: () => {
      invalidate()
      toast.success("Instance URL saved")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createInvite = useMutation({
    mutationFn: (input: { label: string; quotaGb: number }) =>
      post({ action: "createInvite", ...input }) as Promise<{
        inviteCode: string
        expiresAt: string
        quotaGb: number
      }>,
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const acceptInvite = useMutation({
    mutationFn: (input: { inviteCode: string; label: string }) =>
      post({ action: "acceptInvite", ...input }),
    onSuccess: () => {
      invalidate()
      toast.success("Paired with your bro")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => post({ action: "cancelInvite", inviteId }),
    onSuccess: () => {
      invalidate()
      toast.success("Invite cancelled")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revokePeer = useMutation({
    mutationFn: (peerId: string) => post({ action: "revokePeer", peerId }),
    onSuccess: () => {
      invalidate()
      toast.success("Peer revoked")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return {
    ...query,
    setBaseUrl,
    createInvite,
    acceptInvite,
    cancelInvite,
    revokePeer,
  }
}
