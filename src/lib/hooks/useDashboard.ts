import { useQuery } from "@tanstack/react-query"
import type { UpcomingBackup } from "@/lib/cron/format"

export type DashboardDaily = {
  date: string
  success: number
  failed: number
  running: number
  total: number
}

export type DashboardData = {
  days: number
  since: string
  servers: number
  backups: number
  enabledBackups: number
  statusCounts: { running: number; success: number; failed: number }
  totalRuns: number
  successRate: number
  transferredBytes: number
  reportedBackupBytes: number
  avgBackupBytes: number
  daily: DashboardDaily[]
  recentHistory: any[]
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
