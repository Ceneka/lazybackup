"use client"

import { BackupRecipesEmpty } from "@/components/backup-recipes-empty"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { ResourceListCard } from "@/components/resource-list-card"
import { backupOverflowItems } from "@/components/resource-overflow"
import { QueryState } from "@/components/ui/query-state"
import { destinationEndpointKey } from "@/lib/backup/destination"
import {
  destinationEndpointName,
  sourceEndpointName,
  sourcePathLabel,
} from "@/lib/backup/endpoint-display"
import { formatCronExpression } from "@/lib/cron/format"
import { useBackups, useDeleteBackup, type Backup } from "@/lib/hooks/useBackups"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { ArrowRightIcon, CalendarIcon, FolderIcon, PlusIcon } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

function endpointShort(backup: Backup, side: "from" | "to"): string {
  if (side === "from") {
    return `${sourceEndpointName(backup)}:${sourcePathLabel(backup)}`
  }
  return `${destinationEndpointName(backup)}:${backup.destinationPath}`
}

export default function BackupsPage() {
  const query = useBackups()
  const actions = useResourceQuickActions()
  const deleteBackup = useDeleteBackup()

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
    <PageLayout>
      <PageHeader
        title="Backup Configurations"
        actions={
          <Link
            href="/backups/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Backup
          </Link>
        }
      />

      <QueryState
        query={query}
        dataLabel="backup configurations"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        isDataEmpty={() => false}
      >
        {query.data && query.data.length === 0 && <BackupRecipesEmpty />}
        {query.data && query.data.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {query.data.map((backup) => (
              <ResourceListCard
                key={backup.id}
                href={`/backups/${backup.id}`}
                editHref={`/backups/${backup.id}/edit`}
                icon={FolderIcon}
                title={backup.name}
                badges={
                  <div className="mr-1 flex flex-col items-end gap-1">
                    <div
                      className={`rounded-full px-2 py-1 text-xs ${
                        backup.enabled
                          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {backup.enabled ? "Active" : "Disabled"}
                    </div>
                    {duplicateDestinationIds.has(backup.id) && (
                      <div className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        Shared destination
                      </div>
                    )}
                  </div>
                }
                overflow={backupOverflowItems({
                  id: backup.id,
                  name: backup.name,
                  actions,
                  onDelete: () => deleteBackup.mutate(backup.id),
                  isDeleting: deleteBackup.isPending && deleteBackup.variables === backup.id,
                })}
                flash={actions.flashFor(`backup:${backup.id}`)}
              >
                <p className="flex min-w-0 items-start gap-1.5">
                  <span className="truncate" title={endpointShort(backup, "from")}>
                    {endpointShort(backup, "from")}
                  </span>
                  <ArrowRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate" title={endpointShort(backup, "to")}>
                    {endpointShort(backup, "to")}
                  </span>
                </p>
                <div className="mt-1 flex items-center">
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  <span className="text-xs">
                    {formatCronExpression(backup.schedule)} ({backup.schedule})
                  </span>
                </div>
              </ResourceListCard>
            ))}
          </div>
        )}
      </QueryState>
    </PageLayout>
  )
}
