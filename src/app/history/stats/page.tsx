"use client"

import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { QueryState } from "@/components/ui/query-state"
import { useHistoryStats } from "@/lib/hooks/useHistory"
import { formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import {
    ArrowLeftIcon,
    CheckCircleIcon,
    ClockIcon,
    FileIcon,
    HardDriveIcon,
    HistoryIcon,
    PlayIcon,
    XCircleIcon
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function HistoryStatsPage() {
  const router = useRouter()
  const query = useHistoryStats()
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={() => router.push("/history")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold">Backup Statistics</h1>
      </div>
      
      <QueryState 
        query={query}
        dataLabel="statistics"
        errorIcon={<HistoryIcon className="h-12 w-12 text-red-500" />}
      >
        {query.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Backups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{query.data?.totalBackups || 0}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Success Rate
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-3xl font-bold">{query.data?.successRate || 0}%</div>
                  <Progress value={query.data?.successRate || 0} className="h-2" />
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg. Backup Size
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{formatBytes(query.data?.avgSize || 0)}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Backup Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon className="h-4 w-4 text-green-500" />
                      <span>Success</span>
                    </div>
                    <span className="font-medium">{query.data?.statusCounts?.success || 0}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <PlayIcon className="h-4 w-4 text-blue-500" />
                      <span>Running</span>
                    </div>
                    <span className="font-medium">{query.data?.statusCounts?.running || 0}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                      <span>Failed</span>
                    </div>
                    <span className="font-medium">{query.data?.statusCounts?.failed || 0}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {query.data?.recentBackup && (
              <Card>
                <CardHeader>
                  <CardTitle>Most Recent Successful Backup</CardTitle>
                  <CardDescription>
                    {query.data.recentBackup.endTime && (
                      <>Completed on {format(new Date(query.data.recentBackup.endTime), "PPP 'at' p")}</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Backup Configuration
                      </div>
                      <div>
                        <Link 
                          href={`/backups/${query.data.recentBackup.configId}`}
                          className="font-medium hover:underline text-primary"
                        >
                          {query.data.recentBackup.configName}
                        </Link>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <ClockIcon className="w-4 h-4 mr-2" />
                        Duration
                      </div>
                      <div>
                        {(query.data.recentBackup.startTime && query.data.recentBackup.endTime) && (
                          <>
                            {format(new Date(query.data.recentBackup.startTime), "p")} - {format(new Date(query.data.recentBackup.endTime), "p")}
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Files
                      </div>
                      <div>{query.data.recentBackup.fileCount || "N/A"}</div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <HardDriveIcon className="w-4 h-4 mr-2" />
                        Size
                      </div>
                      <div>{query.data.recentBackup.totalSize ? formatBytes(query.data.recentBackup.totalSize) : "N/A"}</div>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <Button 
                      size="sm"
                      onClick={() => router.push(`/history/${query.data.recentBackup.id}`)}
                      variant="outline"
                    >
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </QueryState>
    </div>
  )
} 
