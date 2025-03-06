"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { QueryState } from "@/components/ui/query-state"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, PencilIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export default function ServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [deleting, setDeleting] = useState(false)
  const queryClient = useQueryClient()

  // Fetch server data with useQuery
  const query = useQuery({
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
    setDeleting(true)
    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete server")
      }

      // Invalidate servers query cache
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      
      toast.success("Server deleted successfully")
      router.push("/servers")
    } catch (error) {
      console.error("Error deleting server:", error)
      toast.error("Failed to delete server")
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link href="/servers" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to servers</span>
          </Link>
          <h1 className="text-3xl font-bold">
            <QueryState 
              query={query} 
              dataLabel="server"
              errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
              emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
              emptyMessage="Server not found"
              isDataEmpty={(data) => !data}
              loadingComponent={<span className="text-muted-foreground">Loading server...</span>}
            >
              {query.data?.name}
            </QueryState>
          </h1>
        </div>
      </div>

      <QueryState 
        query={query} 
        dataLabel="server"
        errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="Server not found"
        isDataEmpty={(data) => !data}
      >
        {query.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <h2 className="text-xl font-semibold mb-4">Server Details</h2>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Host</dt>
                  <dd className="text-lg">{query.data.host}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Port</dt>
                  <dd className="text-lg">{query.data.port}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Username</dt>
                  <dd className="text-lg">{query.data.username}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Authentication Type</dt>
                  <dd className="text-lg capitalize">{query.data.authType}</dd>
                </div>
              </dl>
            </div>

            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <h2 className="text-xl font-semibold mb-4">Actions</h2>
              <div className="space-y-4">
                <Link
                  href={`/servers/${serverId}/edit`}
                  className="flex items-center space-x-2 p-3 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  <PencilIcon className="h-5 w-5 mr-2" />
                  <span>Edit Server</span>
                </Link>
                <Link 
                  href={`/backups/new?serverId=${query.data.id}`}
                  className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
                >
                  <ServerIcon className="h-5 w-5" />
                  <span>Create Backup for this Server</span>
                </Link>
                <Link 
                  href={`/servers/${query.data.id}/test`}
                  className="flex items-center space-x-2 p-3 rounded-md hover:bg-accent transition-colors"
                >
                  <ServerIcon className="h-5 w-5" />
                  <span>Test Connection</span>
                </Link>
                <DeleteConfirmationDialog
                  title="Are you absolutely sure?"
                  description="This will permanently delete this server and all associated data. This action cannot be undone."
                  onDelete={handleDelete}
                  isDeleting={deleting}
                  buttonText="Delete Server"
                />
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
} 
