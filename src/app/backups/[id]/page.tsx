"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, CalendarIcon, FolderIcon, Loader2Icon, PlayIcon, ServerIcon, TrashIcon } from "lucide-react"
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

export default function BackupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const backupId = params.id as string
  const queryClient = useQueryClient()

  const { data: backup, isLoading, error } = useQuery<Backup>({
    queryKey: ['backup', backupId],
    queryFn: async () => {
      const response = await fetch(`/api/backups/${backupId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Backup configuration not found")
          router.push("/backups")
          return null as unknown as Backup
        }
        throw new Error("Failed to fetch backup configuration")
      }
      
      return response.json()
    }
  })

  // Show error toast when query fails
  if (error) {
    toast.error("Failed to load backup details")
  }

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete backup configuration")
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success("Backup configuration deleted successfully")
      router.push("/backups")
    },
    onError: (error) => {
      console.error("Error deleting backup configuration:", error)
      toast.error("Failed to delete backup configuration")
    }
  })

  const runBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/backups/${backupId}/run`, {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to run backup")
      }

      return data
    },
    onSuccess: () => {
      toast.success("Backup started successfully")
    },
    onError: (error) => {
      console.error("Error running backup:", error)
      toast.error(error instanceof Error ? error.message : "Failed to run backup")
    }
  })

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this backup configuration? This action cannot be undone.")) {
      return
    }
    
    deleteMutation.mutate()
  }

  const handleRunBackup = async () => {
    runBackupMutation.mutate()
  }

  // Function to format cron expression to human-readable format
  const formatSchedule = (cronExpression: string) => {
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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!backup) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderIcon className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">Backup configuration not found</h3>
        <p className="text-muted-foreground mt-2 mb-4">The backup configuration you're looking for doesn't exist or has been deleted.</p>
        <Link 
          href="/backups" 
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Back to Backups
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link href="/backups" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to backups</span>
          </Link>
          <h1 className="text-3xl font-bold">{backup.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Backup Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Server</dt>
              <dd className="text-lg flex items-center space-x-2">
                <ServerIcon className="h-4 w-4" />
                <span>{backup.server?.name || 'Unknown Server'}</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Source Path</dt>
              <dd className="text-lg">{backup.sourcePath}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Destination Path</dt>
              <dd className="text-lg">{backup.destinationPath}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Schedule</dt>
              <dd className="text-lg flex items-center space-x-2">
                <CalendarIcon className="h-4 w-4" />
                <span>{formatSchedule(backup.schedule)} ({backup.schedule})</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="text-lg">
                <span className={`px-2 py-1 rounded-full text-xs ${backup.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {backup.enabled ? 'Active' : 'Disabled'}
                </span>
              </dd>
            </div>
            {backup.excludePatterns && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Exclude Patterns</dt>
                <dd className="text-sm font-mono bg-gray-100 p-2 rounded mt-1 whitespace-pre-wrap">
                  {backup.excludePatterns}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Actions</h2>
          <div className="space-y-4">
            <button
              onClick={handleRunBackup}
              disabled={runBackupMutation.isPending}
              className="flex w-full items-center space-x-2 p-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {runBackupMutation.isPending ? (
                <>
                  <Loader2Icon className="h-5 w-5 mr-2" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <PlayIcon className="h-5 w-5 mr-2" />
                  <span>Run Now</span>
                </>
              )}
            </button>
            <Link 
              href={`/backups/${backup.id}/edit`}
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <FolderIcon className="h-5 w-5" />
              <span>Edit Backup Configuration</span>
            </Link>
            <Link 
              href={`/history?backupId=${backup.id}`}
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <CalendarIcon className="h-5 w-5" />
              <span>View Backup History</span>
            </Link>
            <Link 
              href={`/servers/${backup.serverId}`}
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <ServerIcon className="h-5 w-5" />
              <span>View Server Details</span>
            </Link>
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="cursor-pointer flex w-full items-center space-x-2 p-3 rounded-md bg-destructive/10 text-destructive-foreground hover:bg-destructive/20 transition-colors"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2Icon className="h-5 w-5 mr-2" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <TrashIcon className="h-5 w-5 mr-2" />
                  <span>Delete</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 
