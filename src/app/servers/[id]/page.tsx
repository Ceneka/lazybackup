"use client"

import {
  DetailField,
  DetailFields,
  ResourceDetailLayout,
} from "@/components/resource-detail-layout"
import { PasswordAuthWarning } from "@/components/connections/server-auth"
import {
  InUseBlockers,
  UsedByBackupsCard,
  type UsedByBackup,
} from "@/components/used-by-backups"
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
      router.push("/connections?tab=servers")
    }
  }, [query.error, router])

  const usedByBackups = query.data?.usedByBackups ?? []

  const handleDelete = () => {
    setDeleteBlockers(null)
    deleteServer.mutate(serverId, {
      onSuccess: () => {
        router.push("/connections?tab=servers")
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
          backHref="/connections?tab=servers"
          backLabel="Back to servers"
          title={query.data.name}
          detailsTitle="Server details"
          details={
            <div className="space-y-4">
              <DetailFields>
                <DetailField label="Host">{query.data.host}</DetailField>
                <DetailField label="Port">{query.data.port}</DetailField>
                <DetailField label="Username">{query.data.username}</DetailField>
                <DetailField label="Authentication">
                  {query.data.authType === "key" ? "Key" : "Password"}
                </DetailField>
                <DetailField label="Credential">
                  {query.data.authType === "password" ? (
                    <span className="text-sm text-amber-700 dark:text-amber-300">
                      Password stored — path transfers need an SSH key
                    </span>
                  ) : query.data.sshKey?.name ? (
                    <Link
                      href="/settings?tab=ssh-keys"
                      className="text-base underline underline-offset-2 hover:no-underline"
                    >
                      Key: {query.data.sshKey.name}
                    </Link>
                  ) : query.data.systemKeyPath ? (
                    <span className="break-all font-mono text-sm">
                      System key: {query.data.systemKeyPath}
                    </span>
                  ) : query.data.hasPrivateKey ? (
                    <span className="text-base">Inline private key stored</span>
                  ) : (
                    <span className="text-sm text-destructive">
                      Key missing — edit the server to select one
                    </span>
                  )}
                </DetailField>
              </DetailFields>
              {query.data.authType === "password" ? (
                <PasswordAuthWarning editHref={`/servers/${serverId}/edit`} />
              ) : null}
            </div>
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
              <InUseBlockers
                blockers={deleteBlockers}
                className="col-span-2 mt-1"
              />
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
