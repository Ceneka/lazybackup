import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

type HistoryFilter = {
  status?: string
  configId?: string
  search?: string
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
  backupConfig: {
    id: string
    name: string
    server: {
      id: string
      name: string
    }
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
      searchParams.set("limit", pagination.limit.toString())
      searchParams.set("offset", pagination.offset.toString())
      
      const res = await fetch(`/api/history?${searchParams.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch history")
      return res.json()
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
  })
}

// Get history statistics
export function useHistoryStats() {
  return useQuery({
    queryKey: ["historyStats"],
    queryFn: async () => {
      const res = await fetch("/api/history/stats")
      if (!res.ok) throw new Error("Failed to fetch history stats")
      return res.json()
    },
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

// Start a backup
export function useStartBackup() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (configId: string) => {
      const res = await fetch("/api/backups/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ configId }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to start backup")
      }
      
      const data = await res.json()
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["history"] })
      toast.success("Backup started successfully")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start backup")
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
