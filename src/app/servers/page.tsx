"use client"

import { PageHeader, PageLayout } from "@/components/page-layout"
import { ResourceListCard } from "@/components/resource-list-card"
import { serverOverflowItems } from "@/components/resource-overflow"
import { QueryState } from "@/components/ui/query-state"
import { useDeleteServer, useServers } from "@/lib/hooks/useServers"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"

export default function ServersPage() {
  const query = useServers()
  const actions = useResourceQuickActions()
  const deleteServer = useDeleteServer()

  return (
    <PageLayout>
      <PageHeader
        title="Servers"
        actions={
          <Link
            href="/servers/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Server
          </Link>
        }
      />

      <QueryState
        query={query}
        dataLabel="servers"
        errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="No servers found"
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
    </PageLayout>
  )
}
