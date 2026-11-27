import { ApiError, readApiError } from "@/lib/api/client-error"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

type HistoryFilter = {
  status?: string
  configId?: string
  search?: string
  day?: string
  /** Inclusive local day key (`YYYY-MM-DD`) for the start of a range. */
  from?: string
  /** Inclusive local day key (`YYYY-MM-DD`) for the end of a range. */
  to?: string
}

type Pagination = {
  limit: number
  offset: number
}

// Type for a backup history entry
export type BackupHistory = {
  id: string
  configId: string
  startTime: string
  endTime?: string | null
  status: "running" | "success" | "failed"
  fileCount?: number | null
  totalSize?: number | null
  transferredSize?: number | null
  errorMessage?: string | null
  logOutput?: string | null
  artifactPath?: string | null
  artifactSha256?: string | null
  mailboxPending?: boolean
  artifactRemoved?: boolean
  /** Contract C4 — composite delivery state for Bro Space destinations. */
  deliveryState?: "stored" | "waiting" | "failed" | null
  deliveryError?: string | null
  /** Contract C5 — restore defaults captured from the run itself. */
  restoreDefaults?: {
    targetPath: string | null
    targetServerId: string | null
    databaseName: string | null
    volumeName: string | null
    configChangedSinceRun: boolean
  } | null
  backupConfig: {
    id: string
    name: string
    sourceKind?: 'local' | 'server' | 's3' | 'git' | null
    sourceType?:
      | 'path'
      | 'docker_volume'
      | 'database'
      | 'lazybackup_instance'
      | 'git_repo'
      | null
    sourcePath?: string | null
    destinationKind?: 'local' | 'server' | 's3' | 'peer' | null
    destinationPath?: string | null
    destinationPeerId?: string | null
    dbEngine?: string | null
    server?: { id?: string | null; name: string } | null
    destinationServer?: {
      id?: string | null
      name: string
      authType?: string | null
    } | null
    sourceS3Profile?: { name: string } | null
    destinationS3Profile?: { name: string } | null
    sourceGitRepo?: { name: string } | null
    destinationPeer?: {
      id?: string | null
      name: string
      kind?: 'lazybro' | 'lazybackup' | null
      remoteBaseUrl?: string | null
      online?: boolean | null
      lastSeenAt?: string | null
    } | null
  }
}

// Get a paginated list of history entries
export function useHistoryList(
  filters: HistoryFilter = {},
  pagination: Pagination = { limit: 10, offset: 0 }
) {
  return useQuery({
    queryKey: ["history", filters, pagination],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (filters.status) searchParams.set("status", filters.status)
      if (filters.configId) searchParams.set("configId", filters.configId)
      if (filters.search) searchParams.set("search", filters.search)
      if (filters.day) searchParams.set("day", filters.day)
      if (filters.from) searchParams.set("from", filters.from)
      if (filters.to) searchParams.set("to", filters.to)
      searchParams.set("limit", pagination.limit.toString())
      searchParams.set("offset", pagination.offset.toString())

      const res = await fetch(`/api/history?${searchParams.toString()}`)
      if (!res.ok) {
        const { message } = await readApiError(res)
        throw new Error(message)
      }
      return res.json()
    },
    refetchInterval: (query) => {
      const rows = query.state.data?.history as
        | { status?: string; mailboxPending?: boolean; deliveryState?: string | null }[]
        | undefined
      // Keep waiting Bro Space rows fresh so they flip to "stored" after the
      // friend's app pulls the artifact (no SSE event for delivery acks).
      const active = rows?.some(
        (h) =>
          h.status === "running" ||
          h.mailboxPending === true ||
          h.deliveryState === "waiting"
      )
      return active ? 15_000 : false
    },
  })
}

// Get a single history entry by ID
export function useHistoryDetail(id: string) {
  return useQuery({
    queryKey: ["history", id],
    queryFn: async () => {
      const res = await fetch(`/api/history/${id}`)
      if (!res.ok) {
        const { message } = await readApiError(res)
        throw new ApiError(message, { status: res.status })
      }
      return res.json() as Promise<BackupHistory>
    },
    enabled: !!id,
    // A missing history row is permanent — fail fast instead of retrying the 404.
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
    // A running job has no SSE update until it finishes; keep the detail fresh
    // so Completed/Duration/log follow the run. Staged Bro Space runs keep
    // polling until the friend ACKs (or the delivery fails).
    refetchInterval: (query) => {
      const entry = query.state.data as
        | {
            status?: string
            endTime?: string | null
            mailboxPending?: boolean
            deliveryState?: string | null
          }
        | undefined
      if (!entry) return false
      if (entry.mailboxPending === true || entry.deliveryState === "waiting") {
        return 15_000
      }
      return entry.status === "running" && !entry.endTime ? 10_000 : false
    },
  })
}

// Get history statistics
export function useHistoryStats() {
  return useQuery({
    queryKey: ["historyStats"],
    queryFn: async () => {
      const res = await fetch("/api/history/stats?chartData=true")
      if (!res.ok) {
        const { message } = await readApiError(res)
        throw new Error(message)
      }
      return res.json()
    },
    // Refresh data every minute
    refetchInterval: 60000,
  })
}

// Delete a history entry
export function useDeleteHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/history/${id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const { message } = await readApiError(res)
        throw new Error(message)
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["history"] })
      queryClient.invalidateQueries({ queryKey: ["historyStats"] })
      toast.success("History entry deleted successfully")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete history entry")
      console.error(error)
    },
  })
}

/** Restore a successful path, Docker volume, or database dump backup */
export function useRestoreBackupHistory() {
  return useMutation({
    mutationFn: async ({
      id,
      volumeName,
      databaseName,
      targetPath,
      allowRetarget,
      targetServerId,
      retry,
    }: {
      id: string
      volumeName?: string
      databaseName?: string
      targetPath?: string
      allowRetarget?: boolean
      targetServerId?: string | null
      /** Forget a failed friend recall and ask again (server: `retry: true`). */
      retry?: boolean
    }) => {
      const res = await fetch(`/api/history/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          volumeName,
          databaseName,
          targetPath,
          allowRetarget,
          targetServerId,
          ...(retry ? { retry: true } : {}),
        }),
      })

      const data = await res.json()
      if (res.status === 202 && data?.status === "waiting") {
        return {
          status: "waiting" as const,
          recallId: String(data.recallId ?? ""),
          message:
            typeof data.message === "string"
              ? data.message
              : "Waiting for your friend’s app — keep it running.",
        }
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to restore backup")
      }

      return {
        status: "ok" as const,
        success: true as const,
        volumeName: data.volumeName as string | undefined,
        database: data.database as string | undefined,
        targetPath: data.targetPath as string | undefined,
        log: data.log as string,
      }
    },
    onSuccess: (data) => {
      if (data.status === "waiting") return
      if (data.database) {
        toast.success(`Restored database "${data.database}" successfully`)
      } else if (data.targetPath) {
        toast.success(`Restored path "${data.targetPath}" successfully`)
      } else {
        toast.success(`Restored volume "${data.volumeName}" successfully`)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to restore backup")
      console.error(error)
    },
  })
}
