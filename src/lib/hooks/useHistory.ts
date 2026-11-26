import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

type HistoryFilter = {
  status?: string
  configId?: string
  search?: string
  day?: string
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
  endTime?: string
  status: "running" | "success" | "failed"
  fileCount?: number
  totalSize?: number
  transferredSize?: number
  errorMessage?: string
  logOutput?: string
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
    sourceType?: 'path' | 'docker_volume' | 'database' | 'lazybackup_instance' | 'git_repo'
    sourcePath?: string
    destinationKind?: 'local' | 'server' | 's3' | 'peer' | null
    destinationPath?: string | null
    destinationPeerId?: string | null
    dbEngine?: string | null
    server: {
      id: string
      name: string
    } | null
    sourceS3Profile?: { name?: string | null } | null
    sourceGitRepo?: { name?: string | null } | null
    destinationPeer?: {
      id?: string | null
      name?: string | null
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
      searchParams.set("limit", pagination.limit.toString())
      searchParams.set("offset", pagination.offset.toString())

      const res = await fetch(`/api/history?${searchParams.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch history")
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
      if (!res.ok) throw new Error("Failed to fetch history entry")
      return res.json()
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const row = query.state.data as
        | {
            status?: string
            mailboxPending?: boolean
            deliveryState?: string | null
          }
        | undefined
      if (!row) return false
      return row.status === "running" ||
        row.mailboxPending === true ||
        row.deliveryState === "waiting"
        ? 15_000
        : false
    },
  })
}

// Get history statistics
export function useHistoryStats() {
  return useQuery({
    queryKey: ["historyStats"],
    queryFn: async () => {
      const res = await fetch("/api/history/stats?chartData=true")
      if (!res.ok) throw new Error("Failed to fetch history stats")
      const data = await res.json()

      // Log the data to help with debugging
      console.log("History stats data:", data)

      return data
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
        throw new Error("Failed to delete history entry")
      }

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["history"] })
      queryClient.invalidateQueries({ queryKey: ["historyStats"] })
      toast.success("History entry deleted successfully")
    },
    onError: (error) => {
      toast.error("Failed to delete history entry")
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
    }: {
      id: string
      volumeName?: string
      databaseName?: string
      targetPath?: string
      allowRetarget?: boolean
      targetServerId?: string | null
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

// Custom hook that combines history list with pagination state
export function usePaginatedHistory(initialFilters: HistoryFilter = {}) {
  const defaultFilters = {
    status: "",
    configId: "",
    search: "",
    day: "",
    ...initialFilters
  };

  const [filters, setFilters] = useState<HistoryFilter>(defaultFilters)
  const [pagination, setPagination] = useState<Pagination>({
    limit: 10,
    offset: 0,
  })

  const query = useHistoryList(filters, pagination)

  const updateFilters = (newFilters: Partial<HistoryFilter>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    // Reset pagination when filters change
    setPagination((prev) => ({ ...prev, offset: 0 }))
  }

  const goToPage = (page: number) => {
    setPagination((prev) => ({
      ...prev,
      offset: page * prev.limit,
    }))
  }

  const nextPage = () => {
    setPagination((prev) => ({
      ...prev,
      offset: prev.offset + prev.limit,
    }))
  }

  const prevPage = () => {
    setPagination((prev) => ({
      ...prev,
      offset: Math.max(0, prev.offset - prev.limit),
    }))
  }

  return {
    ...query,
    filters,
    pagination,
    updateFilters,
    goToPage,
    nextPage,
    prevPage,
  }
} 
