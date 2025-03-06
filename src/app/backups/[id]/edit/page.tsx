"use client"

import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, Loader2Icon } from "lucide-react"
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
    enabled: true,
    enableVersioning: false,
    versionsToKeep: 5,
  })

  // Fetch backup data with useQuery
  const { data: backup, isLoading: loading } = useQuery({
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

  // Update form data when backup data is loaded
  useEffect(() => {
    if (backup) {
      setFormData({
        serverId: backup.serverId || '',
        name: backup.name || '',
        sourcePath: backup.sourcePath || '',
        destinationPath: backup.destinationPath || '',
        schedule: backup.schedule || '',
        excludePatterns: backup.excludePatterns || '',
        enabled: backup.enabled ?? true,
        enableVersioning: backup.enableVersioning ?? false,
        versionsToKeep: backup.versionsToKeep ?? 5,
      })
    }
  }, [backup])

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
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' 
        ? (e.target as HTMLInputElement).checked 
        : value
    }))
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

      toast.success('Backup configuration updated successfully')
      router.push(`/backups/${backupId}`)
    } catch (error) {
      console.error('Error updating backup configuration:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update backup configuration')
    } finally {
      setSaving(false)
    }
  }

  if (loading || loadingServers) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
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
                  Format: minute hour day-of-month month day-of-week (e.g., "0 0 * * *" for daily at midnight)
                </p>
              </div>

              <div>
                <label htmlFor="excludePatterns" className="block text-sm font-medium mb-2">
                  Exclude Patterns (Optional)
                </label>
                <textarea
                  id="excludePatterns"
                  name="excludePatterns"
                  value={formData.excludePatterns}
                  onChange={handleChange}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="*.log\ntmp/*\n.git/"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  One pattern per line. These files/directories will be excluded from the backup.
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
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label htmlFor="enableVersioning" className="text-sm font-medium">
                  Enable versioning
                </label>
              </div>

              <div>
                <label htmlFor="versionsToKeep" className="block text-sm font-medium mb-2">
                  Versions to Keep
                </label>
                <input
                  id="versionsToKeep"
                  name="versionsToKeep"
                  type="number"
                  required
                  value={formData.versionsToKeep}
                  onChange={handleChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="5"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <Link
                href={`/backups/${backupId}`}
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
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
} 
