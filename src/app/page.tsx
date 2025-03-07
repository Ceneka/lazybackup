"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { QueryState } from "@/components/ui/query-state"
import { useHistoryStats } from "@/lib/hooks/useHistory"
import { useStats } from "@/lib/hooks/useStats"
import { CheckCircleIcon, FolderIcon, HistoryIcon, PlayIcon, PlusIcon, ServerIcon, XCircleIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

// Simple Chart component for backup history
function BackupHistoryChart({ data }: { data: any[] }) {
  // Check if we have valid data
  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 bg-muted/20 rounded-lg">
        <p className="text-muted-foreground">
          {!data || !Array.isArray(data)
            ? "No backup data available"
            : "Need at least 2 backups to display chart"}
        </p>
      </div>
    )
  }

  // Process the data for the chart
  const chartData = data.map((item, index) => ({
    status: item.status || 'unknown',
    date: new Date(item.startTime),
    index,
  }))

  // Ensure we have valid dates
  if (chartData.some(item => isNaN(item.date.getTime()))) {
    console.error("Invalid date in chart data", data)
    return (
      <div className="flex items-center justify-center h-40 bg-muted/20 rounded-lg">
        <p className="text-muted-foreground">Error processing chart data</p>
      </div>
    )
  }

  return (
    <div className="h-40 w-full">
      <div className="flex flex-col h-full">
        <div className="flex-1 relative">
          {/* Chart lines */}
          <div className="absolute inset-0 flex items-end">
            {chartData.map((item, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col justify-end items-center"
              >
                <div
                  className={`w-4 rounded-t ${item.status === 'running' ? 'bg-blue-500' :
                    item.status === 'success' ? 'bg-green-500' :
                      item.status === 'failed' ? 'bg-red-500' :
                        'bg-gray-500'
                    }`}
                  style={{
                    height: `${Math.max(20, Math.min(90, (item.index + 1) * 10))}%`,
                  }}
                ></div>
              </div>
            ))}
          </div>
        </div>
        <div className="h-6 flex justify-between text-xs text-muted-foreground pt-2">
          <span>{chartData[0].date.toLocaleDateString()}</span>
          <span>{chartData[chartData.length - 1].date.toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const query = useStats()
  const historyStatsQuery = useHistoryStats()
  const [isClient, setIsClient] = useState(false)

  // Use this to avoid hydration errors with date-related rendering
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Calculate the success rate
  const getSuccessRate = () => {
    if (!query.data) return 0
    const total = query.data.running + query.data.success + query.data.failed
    return total > 0 ? Math.round((query.data.success / total) * 100) : 0
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <QueryState
        query={query}
        dataLabel="dashboard stats"
        loadingComponent={
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="p-6 rounded-lg border bg-card text-card-foreground shadow animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-1/4"></div>
              </div>
            ))}
          </div>
        }
      >
        {query.data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Link
              href="/servers"
              className="p-6 rounded-lg border bg-card text-card-foreground shadow hover:shadow-md transition-all"
            >
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <ServerIcon className="h-5 w-5" />
                <span>Total Servers</span>
              </div>
              <div className="text-3xl font-bold">{query.data.servers}</div>
            </Link>

            <Link
              href="/backups"
              className="p-6 rounded-lg border bg-card text-card-foreground shadow hover:shadow-md transition-all"
            >
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <FolderIcon className="h-5 w-5" />
                <span>Backup Configurations</span>
              </div>
              <div className="text-3xl font-bold">{query.data.backups}</div>
            </Link>

            <Link
              href="/history"
              className="p-6 rounded-lg border bg-card text-card-foreground shadow hover:shadow-md transition-all"
            >
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <HistoryIcon className="h-5 w-5" />
                <span>Backup History</span>
              </div>
              <div className="text-3xl font-bold">{query.data.history}</div>
            </Link>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Backup Status</CardTitle>
              </CardHeader>
              <CardContent>
                {query.data && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <PlayIcon className="h-4 w-4 text-blue-500" />
                          <span className="text-blue-500 font-medium">{query.data.running}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircleIcon className="h-4 w-4 text-green-500" />
                          <span className="text-green-500 font-medium">{query.data.success}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <XCircleIcon className="h-4 w-4 text-red-500" />
                          <span className="text-red-500 font-medium">{query.data.failed}</span>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Success Rate: {isClient ? getSuccessRate() : 0}%
                      </div>
                    </div>
                    <Progress value={isClient ? getSuccessRate() : 0} className="h-1.5" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Backup History</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            query={historyStatsQuery}
            dataLabel="backup history chart"
            loadingComponent={
              <div className="h-40 w-full bg-muted/20 rounded-lg animate-pulse" />
            }
          >
            {historyStatsQuery.data?.chartHistory && historyStatsQuery.data.chartHistory.length > 0 ? (
              <BackupHistoryChart data={historyStatsQuery.data.chartHistory} />
            ) : (
              <div className="flex items-center justify-center h-40 bg-muted/20 rounded-lg">
                <p className="text-muted-foreground">No backup history data available</p>
              </div>
            )}
          </QueryState>
          <div className="text-center mt-4">
            <Link
              href="/history"
              className="text-sm text-blue-500 hover:underline"
            >
              View all history
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-4">
            <Link
              href="/servers/new"
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Add New Server</span>
            </Link>
            <Link
              href="/backups/new"
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Create New Backup</span>
            </Link>
          </div>
        </div>

        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
          <QueryState
            query={query}
            loadingComponent={
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            }
          >
            {query.data?.recentHistory && query.data.recentHistory.length > 0 ? (
              <div className="space-y-3">
                {query.data.recentHistory.map((item: any) => (
                  <Link
                    href={`/history/${item.id}`}
                    key={item.id}
                    className="block p-3 rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className={`h-2 w-2 rounded-full ${item.status === 'running' ? 'bg-blue-500' :
                          item.status === 'success' ? 'bg-green-500' :
                            'bg-red-500'
                          }`} />
                        <span>{item.backupConfig?.name || 'Unnamed Backup'}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {isClient ? new Date(item.startTime).toLocaleString() : ''}
                      </span>
                    </div>
                    {item.status === 'failed' && item.errorMessage && (
                      <p className="text-sm text-red-500 mt-1 pl-4">
                        Error: {item.errorMessage}
                      </p>
                    )}
                  </Link>
                ))}
                <div className="text-center mt-4">
                  <Link
                    href="/history"
                    className="text-sm text-blue-500 hover:underline"
                  >
                    View all activity
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground text-center py-6">
                <HistoryIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No recent backup activity found</p>
              </div>
            )}
          </QueryState>
        </div>
      </div>
    </div>
  )
}
