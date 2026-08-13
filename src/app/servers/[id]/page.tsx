"use client"

import {
  DetailField,
  DetailFields,
  ResourceDetailLayout,
} from "@/components/resource-detail-layout"
import { backupRoleLabel, UsedByBackupsCard, type UsedByBackup } from "@/components/used-by-backups"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
  detailActionDestructiveClassName,
} from "@/components/ui/detail-actions"
import { QueryState } from "@/components/ui/query-state"
import { isResourceInUseError } from "@/lib/api/resource-in-use"
import { useDeleteServer, useServer } from "@/lib/hooks/useServers"
import { useQueryClient } from "@tanstack/react-query"
import { CableIcon, FolderPlusIcon, PencilIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function ServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [deleteBlockers, setDeleteBlockers] = useState<UsedByBackup[] | null>(null)
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
    <QueryState
      query={query}
      dataLabel="server"
      errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="Server not found"
      isDataEmpty={(data) => !data}
    >
      {query.data ? (
        <ResourceDetailLayout
          backHref="/servers"
          backLabel="Back to servers"
          title={query.data.name}
          detailsTitle="Server Details"
          details={
            <DetailFields>
              <DetailField label="Host">{query.data.host}</DetailField>
              <DetailField label="Port">{query.data.port}</DetailField>
              <DetailField label="Username">{query.data.username}</DetailField>
              <DetailField label="Authentication Type">
                <span className="capitalize">{query.data.authType}</span>
              </DetailField>
            </DetailFields>
          }
          actions={
            <DetailActions>
              <DetailActionLink href={`/servers/${serverId}/edit`} variant="secondary">
                <PencilIcon />
                Edit
              </DetailActionLink>
              <DetailActionLink href={`/backups/new?serverId=${query.data.id}`}>
                <FolderPlusIcon />
                Create backup
              </DetailActionLink>
              <DetailActionLink href={`/servers/${query.data.id}/test`}>
                <CableIcon />
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
                triggerButtonClassName={detailActionDestructiveClassName}
              />
              {(deleteBlockers?.length || 0) > 0 && (
                <div className="col-span-2 mt-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-medium text-destructive">Cannot delete — still used by:</p>
                  <ul className="mt-2 space-y-1">
                    {(deleteBlockers ?? []).map((backup) => (
                      <li key={backup.id}>
                        <Link href={`/backups/${backup.id}`} className="underline hover:no-underline">
                          {backup.name}
                        </Link>
                        <span className="ml-2 text-muted-foreground">
                          ({backupRoleLabel(backup.roles)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </DetailActions>
          }
        >
          <UsedByBackupsCard
            description="Backup configurations that use this server as a source or destination."
            backups={usedByBackups}
          />
        </ResourceDetailLayout>
      ) : null}
    </QueryState>
  )
}
