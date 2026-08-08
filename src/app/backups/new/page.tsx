"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ArrowLeftIcon, Loader2Icon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { toast } from "sonner"

// Component that uses useSearchParams
function NewBackupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    serverId: searchParams.get('serverId') || '',
    name: '',
    sourcePath: '',
    destinationPath: '',
    schedule: '0 0 * * *', // Default: daily at midnight
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

  // Fetch servers data with useQuery
  const { data: servers = [], isLoading: loadingServers } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: async () => {
      const response = await fetch('/api/servers')

      if (!response.ok) {
        throw new Error("Failed to fetch servers")
      }

      return response.json()
    }
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined

    setFormData(prev => {
      const next = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }

      // Versioning and file retention are mutually exclusive
      if (name === 'enableVersioning' && checked) {
        next.enableFileRetention = false
      }
      if (name === 'enableFileRetention' && checked) {
        next.enableVersioning = false
      }

      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch('/api/backups', {
        method: 'POST',
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
        throw new Error(data.error || 'Failed to create backup configuration')
      }

      // Invalidate backups query cache
      queryClient.invalidateQueries({ queryKey: ['backups'] })

      toast.success('Backup configuration added successfully')
      router.push('/backups')
    } catch (error) {
      console.error('Error adding backup configuration:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to add backup configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Link href="/backups" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to backups</span>
        </Link>
        <h1 className="text-3xl font-bold">Add New Backup</h1>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground shadow">
        <div className="p-6">
          {loadingServers ? (
            <div className="flex justify-center items-center py-12">
              <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ServerIcon className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No servers found</h3>
              <p className="text-muted-foreground mt-2 mb-4">You need to add a server before creating a backup configuration.</p>
              <Link
                href="/servers/new"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                <ServerIcon className="mr-2 h-4 w-4" />
                Add Server
              </Link>
            </div>
          ) : (
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
                    {servers.map((server) => (
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
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Daily Website Backup"
                  />
                </div>

                <div>
                  <label htmlFor="sourcePath" className="block text-sm font-medium mb-2">
                    Source Path
                  </label>
                  <input
                    id="sourcePath"
                    name="sourcePath"
                    type="text"
                    required
                    value={formData.sourcePath}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="/var/www/html"
                  />
                </div>

                <div>
                  <label htmlFor="destinationPath" className="block text-sm font-medium mb-2">
                    Destination Path
                  </label>
                  <input
                    id="destinationPath"
                    name="destinationPath"
                    type="text"
                    required
                    value={formData.destinationPath}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="/backups/website"
                  />
                </div>

                <div>
                  <label htmlFor="schedule" className="block text-sm font-medium mb-2">
                    Schedule (Cron Expression)
                  </label>
                  <input
                    id="schedule"
                    name="schedule"
                    type="text"
                    required
                    value={formData.schedule}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="0 0 * * *"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Format: minute hour day-of-month month day-of-week (e.g., &quot;0 0 * * *&quot; for daily at midnight in the app timezone from Settings)
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
                    id="enabled"
                    name="enabled"
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={handleChange}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label htmlFor="enabled" className="text-sm font-medium">
                    Enable this backup configuration
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
                  href="/backups"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                >
                  {saving ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add Backup"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// Main component with Suspense boundary
export default function NewBackupPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <NewBackupForm />
    </Suspense>
  )
}
