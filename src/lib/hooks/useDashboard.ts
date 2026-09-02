import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UpcomingBackup } from "@/lib/cron/format"
import { toast } from "sonner"

export type DashboardDaily = {
  date: string
  success: number
  failed: number
  running: number
  total: number
}

export type DashboardServerItem = {
  id: string
  name: string
  host: string
  port: number
}

export type DashboardS3Item = {
  id: string
  name: string
  bucket: string
  endpoint: string
}

export type DashboardBackupItem = {
  id: string
  name: string
  enabled: boolean
}

export type DashboardLastFailure = {
  id: string
  configName: string
  startTime: string
  errorSnippet: string | null
}

export type DashboardData = {
  days: number
  since: string
  servers: number
  s3Profiles: number
  backups: number
  enabledBackups: number
  serverList: DashboardServerItem[]
  s3ProfileList: DashboardS3Item[]
  backupList: DashboardBackupItem[]
  statusCounts: { running: number; success: number; failed: number }
  totalRuns: number
  successRate: number
  transferredBytes: number
  reportedBackupBytes: number
  avgBackupBytes: number
  daily: DashboardDaily[]
  recentHistory: any[]
  lastFailure: DashboardLastFailure | null
  timezone: string
  upcomingBackups: UpcomingBackup[]
  storage: {
    path: string
    exists: boolean
    totalBytes: number
    totalSize: string
    fileCount: number
    directoryCount: number
    topLevelEntries: number
    latest?: {
      name: string
      path: string
      size: string
      bytes: number
      mtime: string
    } | null
  }
}

export function useDashboard(days = 30) {
  return useQuery({
    queryKey: ["dashboard", days],
    queryFn: async (): Promise<DashboardData> => {
      const res = await fetch(`/api/dashboard?days=${days}`)
      if (!res.ok) throw new Error("Failed to fetch dashboard")
      return res.json()
    },
    refetchInterval: 60_000,
  })
}

/** Dev-only POST /api/seed — production API returns 403. */
export function useSeedDemo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/seed", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to seed demo data")
      }
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries()
      toast.success("Loaded screenshot fixtures")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to seed demo data")
    },
  })
}
