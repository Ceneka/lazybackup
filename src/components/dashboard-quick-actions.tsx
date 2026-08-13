"use client"

import { Button } from "@/components/ui/button"
import {
  backupOverflowItems,
  ResourceQuickActionBar,
  s3OverflowItems,
  serverOverflowItems,
} from "@/components/resource-overflow"
import type {
  DashboardBackupItem,
  DashboardS3Item,
  DashboardServerItem,
} from "@/lib/hooks/useDashboard"
import { useDeleteBackup } from "@/lib/hooks/useBackups"
import { useDeleteS3Profile } from "@/lib/hooks/useS3Profiles"
import { useDeleteServer } from "@/lib/hooks/useServers"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { CloudIcon, FolderIcon, PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

function ResourceCard({
  title,
  href,
  addHref,
  addLabel,
  icon: Icon,
  empty,
  children,
}: {
  title: string
  href: string
  addHref: string
  addLabel: string
  icon: typeof ServerIcon
  empty: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Icon className="h-5 w-5 text-muted-foreground" />
          {title}
        </h2>
        <Button variant="outline" size="sm" asChild>
          <Link href={addHref}>
            <PlusIcon className="h-4 w-4" />
            {addLabel}
          </Link>
        </Button>
      </div>
      {empty ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nothing here yet.{" "}
          <Link href={addHref} className="text-blue-500 hover:underline">
            {addLabel}
          </Link>
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">{children}</div>
      )}
      <div className="mt-4 text-center">
        <Link href={href} className="text-sm text-blue-500 hover:underline">
          View all
        </Link>
      </div>
    </div>
  )
}

export function DashboardQuickActions({
  servers,
  s3Profiles,
  backups,
}: {
  servers: DashboardServerItem[]
  s3Profiles: DashboardS3Item[]
  backups: DashboardBackupItem[]
}) {
  const actions = useResourceQuickActions()
  const deleteServer = useDeleteServer()
  const deleteProfile = useDeleteS3Profile()
  const deleteBackup = useDeleteBackup()

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      <ResourceCard
        title="Servers"
        href="/servers"
        addHref="/servers/new"
        addLabel="Add"
        icon={ServerIcon}
        empty={servers.length === 0}
      >
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-accent/50"
          >
            <Link href={`/servers/${server.id}`} className="min-w-0">
              <div className="truncate font-medium">{server.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {server.host}:{server.port}
              </div>
            </Link>
            <ResourceQuickActionBar
              editHref={`/servers/${server.id}/edit`}
              editLabel={`Edit ${server.name}`}
              flash={actions.flashFor(`server:${server.id}`)}
              overflow={serverOverflowItems({
                id: server.id,
                name: server.name,
                actions,
                onDelete: () => deleteServer.mutate(server.id),
                isDeleting: deleteServer.isPending && deleteServer.variables === server.id,
              })}
            />
          </div>
        ))}
      </ResourceCard>

      <ResourceCard
        title="S3"
        href="/s3-profiles"
        addHref="/s3-profiles/new"
        addLabel="Add"
        icon={CloudIcon}
        empty={s3Profiles.length === 0}
      >
        {s3Profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-accent/50"
          >
            <Link href={`/s3-profiles/${profile.id}`} className="min-w-0">
              <div className="truncate font-medium">{profile.name}</div>
              <div className="truncate text-xs text-muted-foreground">{profile.bucket}</div>
            </Link>
            <ResourceQuickActionBar
              editHref={`/s3-profiles/${profile.id}/edit`}
              editLabel={`Edit ${profile.name}`}
              flash={actions.flashFor(`s3:${profile.id}`)}
              overflow={s3OverflowItems({
                id: profile.id,
                name: profile.name,
                actions,
                onDelete: () => deleteProfile.mutate(profile.id),
                isDeleting: deleteProfile.isPending && deleteProfile.variables === profile.id,
              })}
            />
          </div>
        ))}
      </ResourceCard>

      <ResourceCard
        title="Backups"
        href="/backups"
        addHref="/backups/new"
        addLabel="Add"
        icon={FolderIcon}
        empty={backups.length === 0}
      >
        {backups.map((backup) => (
          <div
            key={backup.id}
            className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-accent/50"
          >
            <Link href={`/backups/${backup.id}`} className="min-w-0">
              <div className="truncate font-medium">{backup.name}</div>
              <div className="text-xs text-muted-foreground">
                {backup.enabled ? "Active" : "Disabled"}
              </div>
            </Link>
            <ResourceQuickActionBar
              editHref={`/backups/${backup.id}/edit`}
              editLabel={`Edit ${backup.name}`}
              flash={actions.flashFor(`backup:${backup.id}`)}
              overflow={backupOverflowItems({
                id: backup.id,
                name: backup.name,
                actions,
                onDelete: () => deleteBackup.mutate(backup.id),
                isDeleting: deleteBackup.isPending && deleteBackup.variables === backup.id,
              })}
            />
          </div>
        ))}
      </ResourceCard>
    </div>
  )
}
