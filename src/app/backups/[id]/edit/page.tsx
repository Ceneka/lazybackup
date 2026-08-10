"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Server, useServerDockerVolumes } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ArrowLeftIcon, FolderIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
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
    sourceType: 'path' as 'path' | 'docker_volume',
    sourcePath: '',
    destinationPath: '',
    schedule: '',
    excludePatterns: '',
    preBackupCommands: '',
    enabled: true,
    enableVersioning: false,
    versionsToKeep: 5,
    enableFileRetention: false,
    retentionMaxAge: 30,
    retentionMaxAgeUnit: 'days' as 'days' | 'months',
    retentionMinKeep: 5,
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

  const volumesQuery = useServerDockerVolumes(
    formData.sourceType === 'docker_volume' ? formData.serverId : ''
  )

  useEffect(() => {
    // If we have backup data, populate the form
    if (backupQuery.data) {
      setFormData({
        serverId: backupQuery.data.serverId || '',
        name: backupQuery.data.name || '',
        sourceType: backupQuery.data.sourceType || 'path',
        sourcePath: backupQuery.data.sourcePath || '',
        destinationPath: backupQuery.data.destinationPath || '',
        schedule: backupQuery.data.schedule || '',
        excludePatterns: backupQuery.data.excludePatterns || '',
        preBackupCommands: backupQuery.data.preBackupCommands || '',
        enabled: backupQuery.data.enabled !== undefined ? backupQuery.data.enabled : true,
        enableVersioning: backupQuery.data.enableVersioning || false,
        versionsToKeep: backupQuery.data.versionsToKeep || 5,
        enableFileRetention: backupQuery.data.enableFileRetention || false,
        retentionMaxAge: backupQuery.data.retentionMaxAge || 30,
        retentionMaxAgeUnit: backupQuery.data.retentionMaxAgeUnit || 'days',
        retentionMinKeep: backupQuery.data.retentionMinKeep || 5,
      })
    }
  }, [backupQuery.data])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined

    setFormData(prev => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }

      if (name === 'enableVersioning' && checked) {
        next.enableFileRetention = false
      }
      if (name === 'enableFileRetention' && checked) {
        next.enableVersioning = false
      }

      if (name === 'sourceType') {
        next.sourcePath = ''
      }

      if (name === 'serverId' && prev.sourceType === 'docker_volume') {
        next.sourcePath = ''
      }

      return next
    })
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
        body: JSON.stringify({
          ...formData,
          versionsToKeep: Number(formData.versionsToKeep),
          retentionMaxAge: Number(formData.retentionMaxAge),
          retentionMinKeep: Number(formData.retentionMinKeep),
        }),
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
                    <label htmlFor="sourceType" className="block text-sm font-medium mb-2">
                      Source Type
                    </label>
                    <select
                      id="sourceType"
                      name="sourceType"
                      value={formData.sourceType}
                      onChange={handleChange}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="path">Filesystem path</option>
                      <option value="docker_volume">Docker volume</option>
                    </select>
                  </div>

                  {formData.sourceType === 'docker_volume' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="sourcePath" className="block text-sm font-medium">
                          Docker Volume
                        </label>
                        <button
                          type="button"
                          disabled={!formData.serverId || volumesQuery.isFetching}
                          onClick={() => volumesQuery.refetch()}
                          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          <RefreshCwIcon className={`mr-1 h-3 w-3 ${volumesQuery.isFetching ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                      </div>
                      {!formData.serverId ? (
                        <p className="text-sm text-muted-foreground">Select a server to discover volumes.</p>
                      ) : volumesQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2Icon className="h-4 w-4 animate-spin" />
                          Loading volumes…
                        </div>
                      ) : volumesQuery.isError ? (
                        <Alert variant="destructive">
                          <AlertTriangleIcon />
                          <AlertTitle>Could not list Docker volumes</AlertTitle>
                          <AlertDescription>
                            {volumesQuery.error instanceof Error
                              ? volumesQuery.error.message
                              : 'Docker must be available and this SSH user needs docker access.'}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <select
                          id="sourcePath"
                          name="sourcePath"
                          required
                          value={formData.sourcePath}
                          onChange={handleChange}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <option value="">Select a volume</option>
                          {formData.sourcePath &&
                            !(volumesQuery.data || []).includes(formData.sourcePath) && (
                              <option value={formData.sourcePath}>{formData.sourcePath} (current)</option>
                            )}
                          {(volumesQuery.data || []).map((volume) => (
                            <option key={volume} value={volume}>
                              {volume}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Requires Docker on the remote host and SSH key auth. Live databases may be inconsistent unless you stop them first (use pre-backup commands).
                      </p>
                    </div>
                  ) : (
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
                  )}

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
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                      Example: <code>0 0 * * *</code> for daily at midnight (app timezone in Settings), <code>0 * * * *</code> for hourly
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
                      {formData.sourceType === 'docker_volume'
                        ? 'Optional tar exclude patterns, one per line (e.g. lost+found)'
                        : 'Enter patterns to exclude, one per line (e.g., *.log, tmp/*)'}
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
                      {formData.sourceType === 'docker_volume'
                        ? 'Optional: e.g. docker compose stop db — run on the remote before packing the volume'
                        : 'Enter commands to run on the remote server before backup starts, one per line'}
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="enabled"
                      name="enabled"
                      checked={formData.enabled}
                      onChange={handleChange}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="enabled" className="text-sm font-medium">
                      Enabled
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      id="enableVersioning"
                      name="enableVersioning"
                      type="checkbox"
                      checked={formData.enableVersioning}
                      onChange={handleChange}
                      disabled={formData.enableFileRetention}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                    />
                    <label htmlFor="enableVersioning" className="text-sm font-medium">
                      Enable versioning
                    </label>
                  </div>
                  {formData.enableFileRetention && (
                    <p className="text-xs text-muted-foreground -mt-2">
                      Turn off file retention to use versioning.
                    </p>
                  )}

                  {formData.enableVersioning && (
                    <div>
                      <label htmlFor="versionsToKeep" className="block text-sm font-medium mb-2">
                        Versions to Keep
                      </label>
                      <input
                        id="versionsToKeep"
                        name="versionsToKeep"
                        type="number"
                        min={1}
                        max={100}
                        required
                        value={formData.versionsToKeep}
                        onChange={handleChange}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="5"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Number of version folders to keep
                      </p>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <input
                      id="enableFileRetention"
                      name="enableFileRetention"
                      type="checkbox"
                      checked={formData.enableFileRetention}
                      onChange={handleChange}
                      disabled={formData.enableVersioning}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                    />
                    <label htmlFor="enableFileRetention" className="text-sm font-medium">
                      Enable file retention
                    </label>
                  </div>
                  {formData.enableVersioning && (
                    <p className="text-xs text-muted-foreground -mt-2">
                      File retention is only available when versioning is off (for dump folders that accumulate files).
                    </p>
                  )}

                  {formData.enableFileRetention && (
                    <div className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
                      <Alert variant="destructive">
                        <AlertTriangleIcon />
                        <AlertTitle>Be careful — this permanently deletes files</AlertTitle>
                        <AlertDescription>
                          <p>
                            After each successful backup, LazyBackup deletes top-level files in the
                            destination that are older than the age you set, while always keeping at least the newest
                            minimum count. Misconfiguration can wipe dump files you still need. Directories are never deleted.
                          </p>
                        </AlertDescription>
                      </Alert>

                      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                        <div>
                          <label htmlFor="retentionMaxAge" className="block text-sm font-medium mb-2">
                            Delete files older than
                          </label>
                          <input
                            id="retentionMaxAge"
                            name="retentionMaxAge"
                            type="number"
                            min={1}
                            max={3650}
                            required
                            value={formData.retentionMaxAge}
                            onChange={handleChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label htmlFor="retentionMaxAgeUnit" className="block text-sm font-medium mb-2">
                            Unit
                          </label>
                          <select
                            id="retentionMaxAgeUnit"
                            name="retentionMaxAgeUnit"
                            value={formData.retentionMaxAgeUnit}
                            onChange={handleChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <option value="days">Days</option>
                            <option value="months">Months</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="retentionMinKeep" className="block text-sm font-medium mb-2">
                          Keep at least (newest files)
                        </label>
                        <input
                          id="retentionMinKeep"
                          name="retentionMinKeep"
                          type="number"
                          min={1}
                          max={10000}
                          required
                          value={formData.retentionMinKeep}
                          onChange={handleChange}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Always preserve this many newest files, even if they are older than the age limit.
                        </p>
                      </div>
                    </div>
                  )}
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
