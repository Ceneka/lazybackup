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
  transport: "mailbox" | "direct"
  status: string
  inboundTokenPrefix: string
  lastSeenAt: string | null
  lastActivityAt: string | null
  pendingSyncCount?: number
  createdAt: string
  updatedAt: string
  // Contract C1 (owner: delivery/reporting task) — all optional so this UI
  // renders gracefully before the backend lands.
  kind?: "lazybro" | "lazybackup"
  online?: boolean
  pendingBytes?: number
  oldestPendingAt?: string | null
  /** Bytes OUR backups use on THEIR disk, as reported by them. */
  remoteUsedBytes?: number | null
  remoteQuotaBytes?: number | null
  remoteLastError?: string | null
  remoteLastSyncAt?: string | null
  remoteAppVersion?: string | null
  remoteReportedAt?: string | null
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
  /** Present once the invite has been consumed. */
  peerId?: string | null
}

export type PeersResponse = {
  instanceBaseUrl: string | null
  peers: PeerSummary[]
  invites: PeerInviteSummary[]
}

export type RemovePeerResult = {
  removed?: boolean
  disabledBackups?: number
  freedBytes?: number
}

export const peerKeys = {
  all: ["peers"] as const,
}

/** Keep raw transport text out of toasts. */
export function friendlyPeerError(message: string, fallback: string): string {
  const text = (message || "").trim()
  if (!text) return fallback
  if (/fetch failed|failed to fetch|networkerror/i.test(text)) {
    return "Couldn’t reach that address. Check it and try again."
  }
  if (/must use https|use https:\/\//i.test(text)) {
    return "Public addresses must use https://. Pick an HTTPS address, Tailscale, or an allowed home-network address."
  }
  if (/targets a disallowed address|private/i.test(text)) {
    return "That address can’t be used for invites. Pick a public, Tailscale, or allowed home-network address."
  }
  return text
}

/** Invite-specific mapping: never show a parser error or a bare "Validation error". */
function friendlyAcceptError(message: string): string {
  const text = (message || "").trim()
  if (/validation error/i.test(text)) {
    return "That invite is incomplete. Paste the whole code."
  }
  if (/json|unexpected token|not valid json/i.test(text)) {
    return "That invite doesn’t look right. Copy the whole message from your friend — it starts with lb1."
  }
  return text
}

async function fetchPeers(): Promise<PeersResponse> {
  const res = await fetch("/api/peers")
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      friendlyPeerError(
        (err as { error?: string }).error || "",
        "Failed to load Bro Space"
      )
    )
  }
  return res.json()
}

function hasPendingInvite(data: PeersResponse | undefined): boolean {
  if (!data?.invites?.length) return false
  return data.invites.some(
    (invite) =>
      invite.status === "pending" &&
      new Date(invite.expiresAt).getTime() > Date.now()
  )
}

/**
 * Bro Space peers/invites.
 *
 * Polls every 3 s while the invite wizard is open or an invite is pending
 * (so pairing shows up without a reload) and every 15 s otherwise.
 */
export function usePeers(options?: { wizardOpen?: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: peerKeys.all,
    queryFn: fetchPeers,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const data = q.state.data as PeersResponse | undefined
      return options?.wizardOpen || hasPendingInvite(data) ? 3_000 : 15_000
    },
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
      throw new Error(
        friendlyPeerError(
          (err as { error?: string }).error || "",
          "Request failed"
        )
      )
    }
    return res.json()
  }

  const setBaseUrl = useMutation({
    mutationFn: (baseUrl: string) => post({ action: "setBaseUrl", baseUrl }),
    onSuccess: () => {
      invalidate()
      toast.success("Address saved")
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
      toast.success("Paired with your friend")
    },
    onError: (e: Error) => toast.error(friendlyAcceptError(e.message)),
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
      toast.success("Access revoked")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Contract C2 (owner: peer-lifecycle task).
  const renamePeer = useMutation({
    mutationFn: (input: { peerId: string; name: string }) =>
      post({ action: "renamePeer", ...input }),
    onSuccess: () => {
      invalidate()
      toast.success("Name updated")
    },
    onError: (e: Error) =>
      toast.error(
        /validation error/i.test(e.message)
          ? "Renaming isn’t available on this version."
          : e.message
      ),
  })

  const removePeer = useMutation({
    mutationFn: (peerId: string) =>
      post({ action: "removePeer", peerId }) as Promise<RemovePeerResult>,
    onSuccess: (result) => {
      invalidate()
      const disabled = result?.disabledBackups ?? 0
      toast.success(
        disabled > 0
          ? `Friend removed. ${disabled} backup${disabled === 1 ? "" : "s"} turned off.`
          : "Friend removed"
      )
    },
    onError: (e: Error) =>
      toast.error(
        /validation error/i.test(e.message)
          ? "Couldn’t remove this friend on this version. Use Revoke access instead."
          : e.message
      ),
  })

  return {
    ...query,
    setBaseUrl,
    createInvite,
    acceptInvite,
    cancelInvite,
    revokePeer,
    renamePeer,
    removePeer,
  }
}
