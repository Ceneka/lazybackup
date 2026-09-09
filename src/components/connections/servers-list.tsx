"use client"

import { ResourceListCard } from "@/components/resource-list-card"
import { serverOverflowItems } from "@/components/resource-overflow"
import { Button } from "@/components/ui/button"
import { QueryState } from "@/components/ui/query-state"
import { useDeleteServer, useServers } from "@/lib/hooks/useServers"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"

export function ConnectionsServersList() {
  const query = useServers()
  const actions = useResourceQuickActions()
  const deleteServer = useDeleteServer()

  return (
    <QueryState
      query={query}
      dataLabel="servers"
      errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="No servers found"
      emptyDescription="Add an SSH host to pull paths, Docker volumes, or database dumps into a From → To backup."
      emptyAction={
        <Button asChild>
          <Link href="/servers/new">
            <PlusIcon className="h-4 w-4" />
            Add your first server
          </Link>
        </Button>
      }
    >
      {query.data && query.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {query.data.map((server) => (
            <ResourceListCard
              key={server.id}
              href={`/servers/${server.id}`}
              editHref={`/servers/${server.id}/edit`}
              icon={ServerIcon}
              title={server.name}
              overflow={serverOverflowItems({
                id: server.id,
                name: server.name,
                actions,
                onDelete: () => deleteServer.mutate(server.id),
                isDeleting: deleteServer.isPending && deleteServer.variables === server.id,
              })}
              flash={actions.flashFor(`server:${server.id}`)}
            >
              <p>
                {server.host}:{server.port}
              </p>
              <p>Username: {server.username}</p>
              <p>Auth: {server.authType}</p>
            </ResourceListCard>
          ))}
        </div>
      )}
    </QueryState>
  )
}
