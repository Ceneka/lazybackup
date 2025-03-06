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
  // We need at least 2 data points for the chart to look good
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 bg-muted/20 rounded-lg">
        <p className="text-muted-foreground">Not enough data to display chart</p>
      </div>
    )
  }

  // Process the data for the chart
  const chartData = data.map((item, index) => ({
    status: item.status,
    date: new Date(item.startTime),
    index,
  }))

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
                      'bg-red-500'
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
          <span>{new Date(chartData[0].date).toLocaleDateString()}</span>
          <span>{new Date(chartData[chartData.length - 1].date).toLocaleDateString()}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          </div>
        )}
      </QueryState>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Backup Status</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={query} dataLabel="backup status">
            {query.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center space-x-2">
                    <PlayIcon className="h-5 w-5 text-blue-500" />
                    <div>
                      <div className="text-muted-foreground text-sm">Running</div>
                      <div className="text-2xl font-bold text-blue-500">{query.data.running}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                    <div>
                      <div className="text-muted-foreground text-sm">Successful</div>
                      <div className="text-2xl font-bold text-green-500">{query.data.success}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <XCircleIcon className="h-5 w-5 text-red-500" />
                    <div>
                      <div className="text-muted-foreground text-sm">Failed</div>
                      <div className="text-2xl font-bold text-red-500">{query.data.failed}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground flex justify-between">
                    <span>Success Rate</span>
                    <span>{isClient ? getSuccessRate() : 0}%</span>
                  </div>
                  <Progress value={isClient ? getSuccessRate() : 0} className="h-2" />
                </div>
              </div>
            )}
          </QueryState>
        </CardContent>
      </Card>

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
            {historyStatsQuery.data?.chartHistory && (
              <BackupHistoryChart data={historyStatsQuery.data.chartHistory} />
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
