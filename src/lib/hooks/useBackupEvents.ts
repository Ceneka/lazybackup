"use client"

import { backupKeys, type Backup } from "@/lib/hooks/useBackups"
import { useAuthStatus } from "@/lib/hooks/useAuth"
import { peerKeys, type PeersResponse } from "@/lib/hooks/usePeers"
import { backupFinishedToast } from "@/lib/backup/delivery-state"
import {
  friendAppKind,
  resolveFriendName,
  resolvePeer,
  type FriendAppKind,
} from "@/lib/peer/friend-copy"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import type { BackupEvent } from "@/lib/events/backup-events"

function invalidateBackupQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["history"] })
  void queryClient.invalidateQueries({ queryKey: backupKeys.all })
  void queryClient.invalidateQueries({ queryKey: ["historyStats"] })
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  void queryClient.invalidateQueries({ queryKey: ["status"] })
}

/**
 * Resolve the friend behind a config from cached queries. The event only
 * carries the config id + mailboxPending, so this avoids an extra fetch on
 * every finished run (and falls back to a lone active peer).
 */
function friendForConfig(
  queryClient: ReturnType<typeof useQueryClient>,
  configId: string
): { name: string; kind: FriendAppKind | null } {
  const backups = queryClient.getQueryData<Backup[]>(backupKeys.lists())
  const config = backups?.find((backup) => backup.id === configId)
  const peers = queryClient.getQueryData<PeersResponse>(peerKeys.all)?.peers
  const peerId = config?.destinationPeerId || null
  const peer = resolvePeer(peers, peerId)
  return {
    name: resolveFriendName(peers, peerId),
    kind: peer ? friendAppKind(peer) : null,
  }
}

function toastFinished(
  event: BackupEvent,
  queryClient: ReturnType<typeof useQueryClient>,
  onView: (historyId: string) => void
) {
  const action = {
    label: "View",
    onClick: () => onView(event.historyId),
  }
  if (event.status === "failed") {
    toast.error(`Backup ${event.backupName} failed`, {
      description: event.errorMessage || undefined,
      action,
    })
    return
  }
  if (event.mailboxPending) {
    const friend = friendForConfig(queryClient, event.configId)
    const copy = backupFinishedToast({
      state: "waiting",
      friendName: friend.name,
      kind: friend.kind,
    })
    toast.info(copy?.title || `Saved on this server — waiting for ${friend.name}`, {
      description: copy?.description,
      action,
    })
    return
  }
  toast.success(`Backup ${event.backupName} finished`, { action })
}

/**
 * Subscribe to GET /api/events and keep history/dashboard queries fresh.
 * Returns null; mount once from AppShell.
 */
export function BackupEventsProvider() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const auth = useAuthStatus()
  const sawOpen = useRef(false)

  const locked = Boolean(auth.data?.authEnabled && !auth.data?.authenticated)

  useEffect(() => {
    if (locked) return

    const source = new EventSource("/api/events")

    const onAny = (raw: MessageEvent<string>) => {
      let event: BackupEvent
      try {
        event = JSON.parse(raw.data) as BackupEvent
      } catch {
        return
      }
      invalidateBackupQueries(queryClient)
      if (event.type === "backup.finished") {
        toastFinished(event, queryClient, (id) => router.push(`/history/${id}`))
      }
    }

    source.addEventListener("backup.started", onAny)
    source.addEventListener("backup.finished", onAny)
    source.onopen = () => {
      if (sawOpen.current) {
        invalidateBackupQueries(queryClient)
      }
      sawOpen.current = true
    }
    source.onerror = () => {
      /* EventSource reconnects on its own */
    }

    return () => {
      source.removeEventListener("backup.started", onAny)
      source.removeEventListener("backup.finished", onAny)
      source.close()
    }
  }, [locked, queryClient, router])

  return null
}
