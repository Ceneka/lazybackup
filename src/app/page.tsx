"use client"

import { QueryState } from "@/components/ui/query-state"
import { useStats } from "@/lib/hooks/useStats"
import { FolderIcon, HistoryIcon, PlayIcon, PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"

export default function Dashboard() {
  const query = useStats()

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      
      <QueryState 
        query={query} 
        dataLabel="dashboard stats"
        loadingComponent={
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
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
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <ServerIcon className="h-5 w-5" />
                <span>Total Servers</span>
              </div>
              <div className="text-3xl font-bold">{query.data.servers}</div>
            </div>
            
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <FolderIcon className="h-5 w-5" />
                <span>Backup Configurations</span>
              </div>
              <div className="text-3xl font-bold">{query.data.backups}</div>
            </div>
            
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <HistoryIcon className="h-5 w-5" />
                <span>Backup History</span>
              </div>
              <div className="text-3xl font-bold">{query.data.history}</div>
            </div>
            
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <PlayIcon className="h-5 w-5 text-blue-500" />
                <span>Running Backups</span>
              </div>
              <div className="text-3xl font-bold text-blue-500">{query.data.running}</div>
            </div>
            
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <HistoryIcon className="h-5 w-5 text-green-500" />
                <span>Successful Backups</span>
              </div>
              <div className="text-3xl font-bold text-green-500">{query.data.success}</div>
            </div>
            
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <div className="flex items-center space-x-2 text-muted-foreground mb-4">
                <HistoryIcon className="h-5 w-5 text-red-500" />
                <span>Failed Backups</span>
              </div>
              <div className="text-3xl font-bold text-red-500">{query.data.failed}</div>
            </div>
          </div>
        )}
      </QueryState>
      
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
                        <div className={`h-2 w-2 rounded-full ${
                          item.status === 'running' ? 'bg-blue-500' : 
                          item.status === 'success' ? 'bg-green-500' : 
                          'bg-red-500'
                        }`} />
                        <span>{item.backupConfig?.name || 'Unnamed Backup'}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(item.startTime).toLocaleString()}
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
