"use client"

import { backupKeys } from "@/lib/hooks/useBackups"
import { useAuthStatus } from "@/lib/hooks/useAuth"
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

function toastFinished(event: BackupEvent, onView: (historyId: string) => void) {
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
  toast.success(
    event.mailboxPending
      ? `Backup ${event.backupName} finished (waiting for bro)`
      : `Backup ${event.backupName} finished`,
    { action }
  )
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
        toastFinished(event, (id) => router.push(`/history/${id}`))
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
