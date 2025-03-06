"use client"

import { QueryState } from "@/components/ui/query-state"
import { useServers } from "@/lib/hooks/useServers"
import { PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"

export default function ServersPage() {
  const query = useServers()

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Servers</h1>
        <Link 
          href="/servers/new" 
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add Server
        </Link>
      </div>

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
    </div>
  )
} 
