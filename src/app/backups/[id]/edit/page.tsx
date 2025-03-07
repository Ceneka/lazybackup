"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, FolderIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function EditBackupPage() {
  const router = useRouter()
  const params = useParams()
  const backupId = params.id as string
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    serverId: '',
    name: '',
    sourcePath: '',
    destinationPath: '',
    schedule: '',
    excludePatterns: '',
    preBackupCommands: '',
    enabled: true,
    enableVersioning: false,
    versionsToKeep: 5,
  })

  // Fetch backup data with useQuery
  const backupQuery = useQuery({
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
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: false
  })

  // Fetch servers data with useQuery
  const serversQuery = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const response = await fetch('/api/servers')

      if (!response.ok) {
        throw new Error("Failed to fetch servers")
      }

      return response.json()
    },
    staleTime: 1000 * 60 * 5 // Cache for 5 minutes
  })

  useEffect(() => {
    // If we have backup data, populate the form
    if (backupQuery.data) {
      setFormData({
        serverId: backupQuery.data.serverId || '',
        name: backupQuery.data.name || '',
        sourcePath: backupQuery.data.sourcePath || '',
        destinationPath: backupQuery.data.destinationPath || '',
        schedule: backupQuery.data.schedule || '',
        excludePatterns: backupQuery.data.excludePatterns || '',
        preBackupCommands: backupQuery.data.preBackupCommands || '',
        enabled: backupQuery.data.enabled !== undefined ? backupQuery.data.enabled : true,
        enableVersioning: backupQuery.data.enableVersioning || false,
        versionsToKeep: backupQuery.data.versionsToKeep || 5,
      })
    }
  }, [backupQuery.data])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    if (type === 'checkbox') {
      setFormData({
        ...formData,
        // @ts-ignore - we know this is a checkbox
        [name]: e.target.checked,
      })
    } else {
      setFormData({
        ...formData,
        [name]: value,
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch(`/api/backups/${backupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update backup configuration')
      }

      // Invalidate backup queries
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['backup', backupId] })

      toast.success('Backup configuration updated successfully')
      router.push(`/backups/${backupId}`)
    } catch (error) {
      console.error('Error updating backup configuration:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update backup configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Link href={`/backups/${backupId}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to backup details</span>
        </Link>
        <h1 className="text-3xl font-bold">Edit Backup</h1>
      </div>

      <QueryState
        query={{
          isLoading: backupQuery.isLoading || serversQuery.isLoading,
          data: { backup: backupQuery.data, servers: serversQuery.data },
          isError: backupQuery.isError || serversQuery.isError,
          error: backupQuery.error || serversQuery.error
        }}
        dataLabel="backup data"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="Backup configuration not found"
        isDataEmpty={(data) => !data.backup}
      >
        {backupQuery.data && serversQuery.data && (
          <div className="rounded-lg border bg-card text-card-foreground shadow">
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="serverId" className="block text-sm font-medium mb-2">
                      Server
                    </label>
                    <select
                      id="serverId"
                      name="serverId"
                      required
                      value={formData.serverId}
                      onChange={handleChange}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Select a server</option>
                      {serversQuery.data.map((server) => (
                        <option key={server.id} value={server.id}>
                          {server.name} ({server.host})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="name" className="block text-sm font-medium mb-2">
                      Backup Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="Daily website backup"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label htmlFor="sourcePath" className="block text-sm font-medium mb-2">
                      Source Path
                    </label>
                    <input
                      type="text"
                      id="sourcePath"
                      name="sourcePath"
                      required
                      value={formData.sourcePath}
                      onChange={handleChange}
                      placeholder="/var/www/mysite"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label htmlFor="destinationPath" className="block text-sm font-medium mb-2">
                      Destination Path
                    </label>
                    <input
                      type="text"
                      id="destinationPath"
                      name="destinationPath"
                      required
                      value={formData.destinationPath}
                      onChange={handleChange}
                      placeholder="/backups/mysite"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label htmlFor="schedule" className="block text-sm font-medium mb-2">
                      Schedule (Cron Expression)
                    </label>
                    <input
                      type="text"
                      id="schedule"
                      name="schedule"
                      required
                      value={formData.schedule}
                      onChange={handleChange}
                      placeholder="0 0 * * *"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Example: <code>0 0 * * *</code> for daily at midnight, <code>0 * * * *</code> for hourly
                    </p>
                  </div>

                  <div className="mb-4">
                    <label htmlFor="excludePatterns" className="block text-sm font-medium mb-1">
                      Exclude Patterns
                    </label>
                    <textarea
                      id="excludePatterns"
                      name="excludePatterns"
                      value={formData.excludePatterns}
                      onChange={handleChange}
                      placeholder="Enter patterns to exclude, one per line"
                      className="w-full min-h-[100px] p-2 border rounded"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Enter patterns to exclude, one per line (e.g., *.log, tmp/*)
                    </p>
                  </div>

                  <div className="mb-4">
                    <label htmlFor="preBackupCommands" className="block text-sm font-medium mb-1">
                      Pre-Backup Commands
                    </label>
                    <textarea
                      id="preBackupCommands"
                      name="preBackupCommands"
                      value={formData.preBackupCommands}
                      onChange={handleChange}
                      placeholder="Enter commands to run before backup, one per line"
                      className="w-full min-h-[100px] p-2 border rounded"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Enter commands to run on the remote server before backup starts, one per line
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="enabled"
                      name="enabled"
                      checked={formData.enabled}
                      onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="enabled" className="text-sm font-medium">
                      Enabled
                    </label>
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Link
                    href={`/backups/${backupId}`}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
                  >
                    Cancel
                  </Link>
                  <LoadingButton
                    type="submit"
                    isLoading={saving}
                    loadingText="Saving..."
                    disabled={saving}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                  >
                    Save Changes
                  </LoadingButton>
                </div>
              </form>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
} 
