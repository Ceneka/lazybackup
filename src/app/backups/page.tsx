"use client"

import { QueryState } from "@/components/ui/query-state"
import { destinationEndpointKey } from "@/lib/backup/destination"
import { formatCronExpression } from "@/lib/cron/format"
import { useBackups, type Backup } from "@/lib/hooks/useBackups"
import { ArrowRightIcon, CalendarIcon, FolderIcon, PlusIcon } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

function endpointShort(backup: Backup, side: "from" | "to"): string {
  if (side === "from") {
    const kind = backup.sourceKind || "server"
    const label =
      kind === "local"
        ? "this host"
        : kind === "s3"
          ? backup.sourceS3Profile?.name || "s3"
          : backup.server?.name || "server"
    const path =
      backup.sourceType === "docker_volume"
        ? `volume:${backup.sourcePath}`
        : backup.sourceType === "database"
          ? `db:${backup.sourcePath}`
          : backup.sourcePath
    return `${label}:${path}`
  }
  const kind = backup.destinationKind || "local"
  const label =
    kind === "local"
      ? "this host"
      : kind === "s3"
        ? backup.destinationS3Profile?.name || "s3"
        : backup.destinationServer?.name || "server"
  return `${label}:${backup.destinationPath}`
}

export default function BackupsPage() {
  const query = useBackups()

  const duplicateDestinationIds = useMemo(() => {
    const ids = new Set<string>()
    const backups = query.data
    if (!backups?.length) {
      return ids
    }

    const byKey = new Map<string, string[]>()
    for (const backup of backups) {
      const key = destinationEndpointKey({
        destinationKind: backup.destinationKind,
        destinationServerId: backup.destinationServerId,
        destinationS3ProfileId: backup.destinationS3ProfileId,
        destinationPath: backup.destinationPath,
      })
      const list = byKey.get(key) || []
      list.push(backup.id)
      byKey.set(key, list)
    }

    for (const idsForKey of byKey.values()) {
      if (idsForKey.length > 1) {
        for (const id of idsForKey) {
          ids.add(id)
        }
      }
    }
    return ids
  }, [query.data])

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

      <QueryState
        query={query}
        dataLabel="backup configurations"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<FolderIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="No backup configurations found"
      >
        {query.data && query.data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {query.data.map((backup) => (
              <Link
                key={backup.id}
                href={`/backups/${backup.id}`}
                className="group block p-6 bg-card text-card-foreground rounded-lg border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center min-w-0">
                    <FolderIcon className="h-5 w-5 mr-2 text-muted-foreground shrink-0" />
                    <h3 className="font-medium truncate">{backup.name}</h3>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div
                      className={`text-xs px-2 py-1 rounded-full ${
                        backup.enabled
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {backup.enabled ? "Active" : "Disabled"}
                    </div>
                    {duplicateDestinationIds.has(backup.id) && (
                      <div className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-900">
                        Shared destination
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground space-y-1">
                  <p className="flex items-start gap-1.5 min-w-0">
                    <span className="truncate" title={endpointShort(backup, "from")}>
                      {endpointShort(backup, "from")}
                    </span>
                    <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="truncate" title={endpointShort(backup, "to")}>
                      {endpointShort(backup, "to")}
                    </span>
                  </p>
                  <div className="flex items-center mt-1">
                    <CalendarIcon className="h-3 w-3 mr-1" />
                    <span className="text-xs">
                      {formatCronExpression(backup.schedule)} ({backup.schedule})
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}
