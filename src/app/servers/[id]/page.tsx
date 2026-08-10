"use client"

import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
} from "@/components/ui/detail-actions"
import { QueryState } from "@/components/ui/query-state"
import { isResourceInUseError } from "@/lib/api/resource-in-use"
import { useDeleteServer, useServer } from "@/lib/hooks/useServers"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CableIcon,
  FolderPlusIcon,
  PencilIcon,
  ServerIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type UsedByBackup = {
  id: string
  name: string
  roles: Array<"source" | "destination">
}

function roleLabel(roles: UsedByBackup["roles"]) {
  if (roles.includes("source") && roles.includes("destination")) {
    return "Source & destination"
  }
  if (roles.includes("destination")) return "Destination"
  return "Source"
}

export default function ServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [deleteBlockers, setDeleteBlockers] = useState<UsedByBackup[] | null>(
    null
  )
  const queryClient = useQueryClient()
  const query = useServer(serverId)
  const deleteServer = useDeleteServer()

  useEffect(() => {
    if (query.error?.message === "Server not found") {
      toast.error("Server not found")
      router.push("/servers")
    }
  }, [query.error, router])

  const usedByBackups = query.data?.usedByBackups ?? []

  const handleDelete = () => {
    setDeleteBlockers(null)
    deleteServer.mutate(serverId, {
      onSuccess: () => {
        router.push("/servers")
      },
      onError: (error) => {
        if (isResourceInUseError(error)) {
          setDeleteBlockers(
            error.resources.map((r) => ({
              id: r.id,
              name: r.name,
              roles: (r.roles as UsedByBackup["roles"]) || ["source"],
            }))
          )
          queryClient.invalidateQueries({ queryKey: ["servers", "detail", serverId] })
        }
      },
    })
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
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Server Details</h2>
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
              </div>

              <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
                <h2 className="mb-4 text-xl font-semibold">Actions</h2>
                <DetailActions>
                  <DetailActionLink
                    href={`/servers/${serverId}/edit`}
                    variant="secondary"
                  >
                    <PencilIcon className="h-4 w-4" />
                    Edit
                  </DetailActionLink>
                  <DetailActionLink href={`/backups/new?serverId=${query.data.id}`}>
                    <FolderPlusIcon className="h-4 w-4" />
                    Create backup
                  </DetailActionLink>
                  <DetailActionLink href={`/servers/${query.data.id}/test`}>
                    <CableIcon className="h-4 w-4" />
                    Test connection
                  </DetailActionLink>

                  <DetailActionsDivider />

                  <DeleteConfirmationDialog
                    title="Delete this server?"
                    description={
                      usedByBackups.length > 0
                        ? "This server is still referenced by backup configurations. Delete will be blocked until those backups are removed or reassigned."
                        : "This will permanently delete this server. This action cannot be undone."
                    }
                    onDelete={handleDelete}
                    isDeleting={deleteServer.isPending}
                    buttonText="Delete"
                  />
                  {(deleteBlockers?.length || 0) > 0 && (
                    <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                      <p className="font-medium text-destructive">
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
                </DetailActions>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">Used by backups</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Backup configurations that use this server as a source or destination.
                </p>
              </div>

              {usedByBackups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No backups reference this server yet.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {usedByBackups.map((backup) => (
                    <li key={backup.id}>
                      <Link
                        href={`/backups/${backup.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-accent/50"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {backup.name}
                        </span>
                        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {roleLabel(backup.roles)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
