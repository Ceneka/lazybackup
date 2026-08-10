"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { QueryState } from "@/components/ui/query-state"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, PencilIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

type UsedByBackup = {
  id: string
  name: string
  roles: Array<"source" | "destination">
}

type ServerDetail = {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: string
  usedByBackups?: UsedByBackup[]
}

function roleLabel(roles: UsedByBackup["roles"]) {
  if (roles.includes("source") && roles.includes("destination")) {
    return "source & destination"
  }
  if (roles.includes("destination")) return "destination"
  return "source"
}

export default function ServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [deleting, setDeleting] = useState(false)
  const [deleteBlockers, setDeleteBlockers] = useState<UsedByBackup[] | null>(
    null
  )
  const queryClient = useQueryClient()

  // Fetch server data with useQuery
  const query = useQuery({
    queryKey: ["server", serverId],
    queryFn: async (): Promise<ServerDetail | null> => {
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
    },
  })

  const usedByBackups = query.data?.usedByBackups ?? []

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteBlockers(null)
    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
          backups?: UsedByBackup[]
        } | null

        if (response.status === 409 && body?.backups?.length) {
          setDeleteBlockers(body.backups)
          toast.error(
            body.error ||
              "Server is used by backup configurations. Delete or reassign those backups first."
          )
          queryClient.invalidateQueries({ queryKey: ["server", serverId] })
          return
        }

        throw new Error(body?.error || "Failed to delete server")
      }

      // Invalidate servers query cache
      queryClient.invalidateQueries({ queryKey: ["servers"] })

      toast.success("Server deleted successfully")
      router.push("/servers")
    } catch (error) {
      console.error("Error deleting server:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to delete server"
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link
            href="/servers"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to servers</span>
          </Link>
          <h1 className="text-3xl font-bold">
            <QueryState
              query={query}
              dataLabel="server"
              errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
              emptyIcon={
                <ServerIcon className="h-12 w-12 text-muted-foreground" />
              }
              emptyMessage="Server not found"
              isDataEmpty={(data) => !data}
              loadingComponent={
                <span className="text-muted-foreground">Loading server...</span>
              }
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
        emptyIcon={
          <ServerIcon className="h-12 w-12 text-muted-foreground" />
        }
        emptyMessage="Server not found"
        isDataEmpty={(data) => !data}
      >
        {query.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
              <h2 className="text-xl font-semibold mb-4">Server Details</h2>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    Host
                  </dt>
                  <dd className="text-lg">{query.data.host}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    Port
                  </dt>
                  <dd className="text-lg">{query.data.port}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    Username
                  </dt>
                  <dd className="text-lg">{query.data.username}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">
                    Authentication Type
                  </dt>
                  <dd className="text-lg capitalize">{query.data.authType}</dd>
                </div>
              </dl>

              {usedByBackups.length > 0 && (
                <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <h3 className="text-sm font-semibold text-amber-200">
                    Used by {usedByBackups.length} backup
                    {usedByBackups.length === 1 ? "" : "s"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Delete or reassign these before removing this server.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {usedByBackups.map((backup) => (
                      <li key={backup.id}>
                        <Link
                          href={`/backups/${backup.id}`}
                          className="text-sm font-medium text-emerald-300 hover:underline"
                        >
                          {backup.name}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({roleLabel(backup.roles)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                  <span>Test server (SSH and backup tools)</span>
                </Link>
                <DeleteConfirmationDialog
                  title="Are you absolutely sure?"
                  description={
                    usedByBackups.length > 0
                      ? "This server is still referenced by backup configurations. Delete will be blocked until those backups are removed or reassigned."
                      : "This will permanently delete this server. This action cannot be undone."
                  }
                  onDelete={handleDelete}
                  isDeleting={deleting}
                  buttonText="Delete Server"
                />
                {(deleteBlockers?.length || 0) > 0 && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <p className="font-medium text-destructive-foreground">
                      Cannot delete — still used by:
                    </p>
                    <ul className="mt-2 space-y-1">
                      {(deleteBlockers ?? []).map((backup) => (
                        <li key={backup.id}>
                          <Link
                            href={`/backups/${backup.id}`}
                            className="underline hover:no-underline"
                          >
                            {backup.name}
                          </Link>
                          <span className="ml-2 text-muted-foreground">
                            ({roleLabel(backup.roles)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
