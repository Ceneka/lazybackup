"use client"

import { useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, ServerIcon, Loader2Icon, TrashIcon } from "lucide-react"
import { toast } from "sonner"

export default function ServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [deleting, setDeleting] = useState(false)

  // Fetch server data with useQuery
  const { data: server, isLoading: loading } = useQuery({
    queryKey: ['server', serverId],
    queryFn: async () => {
      const response = await fetch(`/api/servers/${serverId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Server not found")
          router.push("/servers")
          return null
        }
        throw new Error("Failed to fetch server")
      }
      
      return response.json()
    }
  })

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this server? This action cannot be undone.")) {
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete server")
      }

      toast.success("Server deleted successfully")
      router.push("/servers")
    } catch (error) {
      console.error("Error deleting server:", error)
      toast.error("Failed to delete server")
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!server) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ServerIcon className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">Server not found</h3>
        <p className="text-muted-foreground mt-2 mb-4">The server you're looking for doesn't exist or has been deleted.</p>
        <Link 
          href="/servers" 
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Back to Servers
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link href="/servers" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to servers</span>
          </Link>
          <h1 className="text-3xl font-bold">{server.name}</h1>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2"
        >
          {deleting ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete Server
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Server Details</h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Host</dt>
              <dd className="text-lg">{server.host}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Port</dt>
              <dd className="text-lg">{server.port}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Username</dt>
              <dd className="text-lg">{server.username}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Authentication Type</dt>
              <dd className="text-lg capitalize">{server.authType}</dd>
            </div>
          </dl>
        </div>

        <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
          <h2 className="text-xl font-semibold mb-4">Actions</h2>
          <div className="space-y-4">
            <Link 
              href={`/backups/new?serverId=${server.id}`}
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <ServerIcon className="h-5 w-5" />
              <span>Create Backup for this Server</span>
            </Link>
            <Link 
              href={`/servers/${server.id}/test`}
              className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
            >
              <ServerIcon className="h-5 w-5" />
              <span>Test Connection</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
} 
