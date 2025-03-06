"use client"

import { useServers } from "@/lib/hooks/useServers"
import Link from "next/link"
import { ServerIcon, PlusIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

export default function ServersPage() {
  const { data: servers, isLoading: loading, error: queryError } = useServers()
  const error = queryError ? (queryError instanceof Error ? queryError.message : "An unknown error occurred") : null

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

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ServerIcon className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="text-lg font-medium">Error loading servers</h3>
          <p className="text-muted-foreground mt-2 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            <Loader2Icon className="mr-2 h-4 w-4" />
            Retry
          </button>
        </div>
      ) : servers && servers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
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
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ServerIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No servers found</h3>
          <p className="text-muted-foreground mt-2 mb-4">Add your first server to get started</p>
          <Link 
            href="/servers/new" 
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Server
          </Link>
        </div>
      )}
    </div>
  )
} 
