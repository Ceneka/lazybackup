"use client"

import { PageHeader, PageLayout } from "@/components/page-layout"
import { QueryState } from "@/components/ui/query-state"
import { useServers } from "@/lib/hooks/useServers"
import { PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"

export default function ServersPage() {
  const query = useServers()

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {query.data.map((server) => (
              <Link 
                key={server.id} 
                href={`/servers/${server.id}`}
                className="group block p-6 bg-card text-card-foreground rounded-lg border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center">
                    <ServerIcon className="h-5 w-5 mr-2 text-muted-foreground" />
                    <h3 className="font-medium">{server.name}</h3>
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  <p>{server.host}:{server.port}</p>
                  <p>Username: {server.username}</p>
                  <p>Auth: {server.authType}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </PageLayout>
  )
} 
