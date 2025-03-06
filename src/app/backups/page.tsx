"use client"

import { useBackups } from "@/lib/hooks/useBackups"
import { CalendarIcon, FolderIcon, Loader2Icon, PlusIcon } from "lucide-react"
import Link from "next/link"

export default function BackupsPage() {
  const { data: backups, isLoading: loading, error: queryError } = useBackups()
  const error = queryError ? (queryError instanceof Error ? queryError.message : "An unknown error occurred") : null

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Backup Configurations</h1>
        <Link 
          href="/backups/new" 
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add Backup
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FolderIcon className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="text-lg font-medium">Error loading backups</h3>
          <p className="text-muted-foreground mt-2 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            <Loader2Icon className="mr-2 h-4 w-4" />
            Retry
          </button>
        </div>
      ) : backups && backups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {backups.map((backup) => (
            <Link 
              key={backup.id} 
              href={`/backups/${backup.id}`}
              className="group block p-6 bg-card text-card-foreground rounded-lg border shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center">
                  <FolderIcon className="h-5 w-5 mr-2 text-muted-foreground" />
                  <h3 className="font-medium">{backup.name}</h3>
                </div>
                <div className={`text-xs px-2 py-1 rounded-full ${backup.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {backup.enabled ? 'Active' : 'Disabled'}
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                <p>Source: {backup.sourcePath}</p>
                <p>Destination: {backup.destinationPath}</p>
                <div className="flex items-center mt-1">
                  <CalendarIcon className="h-3 w-3 mr-1" />
                  <span className="text-xs">{backup.schedule}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FolderIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No backup configurations found</h3>
          <p className="text-muted-foreground mt-2 mb-4">Add your first backup configuration to get started</p>
          <Link 
            href="/backups/new" 
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Backup
          </Link>
        </div>
      )}
    </div>
  )
} 
