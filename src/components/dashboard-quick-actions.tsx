"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

const COMPACT_LIST_LIMIT = 3

function ResourceCard({
  title,
  href,
  addHref,
  addLabel,
  addAriaLabel,
  icon: Icon,
  empty,
  itemCount,
  children,
}: {
  title: string
  href: string
  addHref: string
  addLabel: string
  addAriaLabel: string
  icon: typeof ServerIcon
  empty: boolean
  itemCount: number
  children: ReactNode
}) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold">{title}</h2>
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href={addHref} aria-label={addAriaLabel}>
              <PlusIcon aria-hidden="true" className="h-4 w-4" />
              {addLabel}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing here yet.{" "}
            <Link
              href={addHref}
              aria-label={addAriaLabel}
              className="text-blue-700 hover:underline dark:text-blue-400"
            >
              {addAriaLabel}
            </Link>
          </p>
        ) : (
          <div className="space-y-1">{children}</div>
        )}
        <div className="mt-4 flex items-center justify-between gap-2 text-sm">
          <span className="text-xs text-muted-foreground">
            {itemCount > COMPACT_LIST_LIMIT
              ? `Showing ${COMPACT_LIST_LIMIT} of ${itemCount}`
              : ""}
          </span>
          <Link
            href={href}
            className="text-blue-700 hover:underline dark:text-blue-400"
          >
            {empty ? "Open" : "Manage"}
          </Link>
        </div>
      </CardContent>
    </Card>
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
        href="/connections?tab=servers"
        addHref="/servers/new"
        addLabel="Add"
        addAriaLabel="Add server"
        icon={ServerIcon}
        empty={servers.length === 0}
        itemCount={servers.length}
      >
        {servers.slice(0, COMPACT_LIST_LIMIT).map((server) => (
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
        href="/connections?tab=s3"
        addHref="/s3-profiles/new"
        addLabel="Add"
        addAriaLabel="Add S3 profile"
        icon={CloudIcon}
        empty={s3Profiles.length === 0}
        itemCount={s3Profiles.length}
      >
        {s3Profiles.slice(0, COMPACT_LIST_LIMIT).map((profile) => (
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
        addAriaLabel="Add backup"
        icon={FolderIcon}
        empty={backups.length === 0}
        itemCount={backups.length}
      >
        {backups.slice(0, COMPACT_LIST_LIMIT).map((backup) => (
          <div
            key={backup.id}
            className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-accent/50"
          >
            <Link href={`/backups/${backup.id}`} className="min-w-0">
              <div className="truncate font-medium">{backup.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {backup.enabled ? (
                  "Active"
                ) : (
                  <Badge variant="muted">Disabled</Badge>
                )}
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
