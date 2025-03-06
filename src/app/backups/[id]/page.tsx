"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, CalendarIcon, FolderIcon, PlayIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"

// Define types for our data
interface Backup {
  id: string
  name: string
  serverId: string
  server?: {
    name: string
  }
  sourcePath: string
  destinationPath: string
  schedule: string
  enabled: boolean
  excludePatterns?: string
}

// Formatter for cron expressions
const formatCronExpression = (cronExpression: string) => {
  // This is a very simplified formatter - you might want to use a library like cron-parser
  const parts = cronExpression.split(' ')
  if (parts.length !== 5) return cronExpression
  
  // Very basic interpretation
  if (parts[0] === '*' && parts[1] === '*' && parts[2] === '*') {
    return 'Daily'
  } else if (parts[2] === '*' && parts[4] === '*') {
    return 'Hourly'
  } else if (parts[2] === '*') {
    return 'Daily'
  } else if (parts[3] === '*') {
    return 'Monthly'
  } else {
    return cronExpression
  }
}

export default function BackupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const backupId = params.id as string
  const queryClient = useQueryClient()

  // Fetch backup data with useQuery
  const query = useQuery({
    queryKey: ['backup', backupId],
    queryFn: async () => {
      const response = await fetch(`/api/backups/${backupId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Backup configuration not found")
          router.push("/backups")
          return null
        }
        throw new Error("Failed to fetch backup configuration")
      }
      
      return response.json()
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete backup configuration")
      }

      return backupId
    },
    onSuccess: () => {
      // Invalidate backups query cache
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      toast.success("Backup configuration deleted successfully")
      router.push("/backups")
    },
    onError: (error) => {
      console.error("Error deleting backup configuration:", error)
      toast.error("Failed to delete backup configuration")
    }
  })

  // Run backup mutation
  const runBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}/run`, {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to start backup")
      }

      return backupId
    },
    onSuccess: () => {
      // Invalidate history query cache
      queryClient.invalidateQueries({ queryKey: ['history'] })
      toast.success("Backup started successfully")
    },
    onError: (error) => {
      console.error("Error starting backup:", error)
      toast.error("Failed to start backup")
    }
  })

  const handleDelete = async () => {
    deleteMutation.mutate()
  }

  const handleRunBackup = async () => {
    runBackupMutation.mutate()
  }

  const formatSchedule = (cronExpression: string) => {
    try {
      return formatCronExpression(cronExpression)
    } catch (error) {
      return cronExpression
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link href="/backups" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to backups</span>
          </Link>
          <h1 className="text-3xl font-bold">
            <QueryState 
              query={query} 
              dataLabel="backup configuration"
              errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
              emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
              emptyMessage="Backup configuration not found"
              isDataEmpty={(data) => !data}
              loadingComponent={<span className="text-muted-foreground">Loading backup...</span>}
            >
              {query.data?.name}
            </QueryState>
          </h1>
        </div>
      </div>

      <QueryState 
        query={query} 
        dataLabel="backup configuration"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="Backup configuration not found"
        isDataEmpty={(data) => !data}
      >
        {query.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <h2 className="text-xl font-semibold mb-4">Backup Details</h2>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Server</dt>
                  <dd className="text-lg flex items-center space-x-2">
                    <ServerIcon className="h-4 w-4" />
                    <span>{query.data.server?.name || 'Unknown Server'}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Source Path</dt>
                  <dd className="text-lg">{query.data.sourcePath}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Destination Path</dt>
                  <dd className="text-lg">{query.data.destinationPath}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Schedule</dt>
                  <dd className="text-lg flex items-center space-x-2">
                    <CalendarIcon className="h-4 w-4" />
                    <span>{formatSchedule(query.data.schedule)} ({query.data.schedule})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                  <dd className="text-lg">
                    <span className={`px-2 py-1 rounded-full text-xs ${query.data.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {query.data.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </dd>
                </div>
                {query.data.excludePatterns && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Exclude Patterns</dt>
                    <dd className="text-sm font-mono bg-gray-100 p-2 rounded mt-1 whitespace-pre-wrap">
                      {query.data.excludePatterns}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <h2 className="text-xl font-semibold mb-4">Actions</h2>
              <div className="space-y-4">
                <LoadingButton
                  onClick={handleRunBackup}
                  isLoading={runBackupMutation.isPending}
                  loadingText="Running..."
                  className="flex w-full items-center space-x-2 p-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <PlayIcon className="h-5 w-5 mr-2" />
                  <span>Run Now</span>
                </LoadingButton>
                
                <Link 
                  href={`/backups/${query.data.id}/edit`}
                  className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
                >
                  <FolderIcon className="h-5 w-5" />
                  <span>Edit Backup Configuration</span>
                </Link>
                <Link 
                  href={`/history?backupId=${query.data.id}`}
                  className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
                >
                  <CalendarIcon className="h-5 w-5" />
                  <span>View Backup History</span>
                </Link>
                <Link 
                  href={`/servers/${query.data.serverId}`}
                  className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
                >
                  <ServerIcon className="h-5 w-5" />
                  <span>View Server Details</span>
                </Link>
                <DeleteConfirmationDialog
                  title="Are you absolutely sure?"
                  description="This will permanently delete this backup configuration. This action cannot be undone."
                  onDelete={handleDelete}
                  isDeleting={deleteMutation.isPending}
                  buttonText="Delete"
                />
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
} 
