"use client"

import { OverflowMenu, type OverflowItem } from "@/components/overflow-menu"
import type { useResourceQuickActions } from "@/lib/resource-actions"
import { CableIcon, CopyIcon, EyeIcon, FolderPlusIcon, PlayIcon, SettingsIcon } from "lucide-react"
import Link from "next/link"

type QuickActions = ReturnType<typeof useResourceQuickActions>

const gearClassName =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"

export function ResourceQuickActionBar({
  editHref,
  editLabel,
  overflow,
  flash,
}: {
  editHref: string
  editLabel: string
  overflow: OverflowItem[]
  flash?: "success" | "failed" | null
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Link href={editHref} title="Edit" className={gearClassName}>
        <SettingsIcon className="h-4 w-4" />
        <span className="sr-only">{editLabel}</span>
      </Link>
      <OverflowMenu items={overflow} flash={flash} />
    </div>
  )
}

export function serverOverflowItems(opts: {
  id: string
  name: string
  actions: QuickActions
  onDelete: () => void
  isDeleting: boolean
}): OverflowItem[] {
  const { id, name, actions, onDelete, isDeleting } = opts
  return [
    {
      type: "action",
      label: actions.isBusy(`server:${id}`) ? "Testing…" : "Test connection",
      icon: CableIcon,
      disabled: actions.isBusy(`server:${id}`),
      onSelect: () => void actions.testServer(id, name),
    },
    { type: "link", href: `/servers/${id}`, label: "View", icon: EyeIcon },
    {
      type: "link",
      href: `/backups/new?serverId=${id}`,
      label: "Create backup",
      icon: FolderPlusIcon,
    },
    { type: "separator" },
    {
      type: "delete",
      title: "Delete this server?",
      description:
        "This will permanently delete this server. Delete is blocked if backups still use it.",
      onDelete,
      isDeleting,
    },
  ]
}

export function s3OverflowItems(opts: {
  id: string
  name: string
  actions: QuickActions
  onDelete: () => void
  isDeleting: boolean
}): OverflowItem[] {
  const { id, name, actions, onDelete, isDeleting } = opts
  return [
    {
      type: "action",
      label: actions.isBusy(`s3:${id}`) ? "Testing…" : "Test connection",
      icon: CableIcon,
      disabled: actions.isBusy(`s3:${id}`),
      onSelect: () => void actions.testS3(id, name),
    },
    { type: "link", href: `/s3-profiles/${id}`, label: "View", icon: EyeIcon },
    { type: "separator" },
    {
      type: "delete",
      title: "Delete this S3 profile?",
      description: "This cannot be undone. Profiles used by backups cannot be deleted.",
      onDelete,
      isDeleting,
    },
  ]
}

export function backupOverflowItems(opts: {
  id: string
  name: string
  actions: QuickActions
  onDelete: () => void
  isDeleting: boolean
}): OverflowItem[] {
  const { id, name, actions, onDelete, isDeleting } = opts
  return [
    {
      type: "action",
      label: actions.isBusy(`backup:${id}`) ? "Running" : "Run now",
      icon: PlayIcon,
      disabled: actions.isBusy(`backup:${id}`),
      onSelect: () => void actions.runBackup(id, name),
    },
    { type: "link", href: `/backups/${id}`, label: "View", icon: EyeIcon },
    {
      type: "link",
      href: `/backups/new?cloneFrom=${id}`,
      label: "Clone",
      icon: CopyIcon,
    },
    { type: "separator" },
    {
      type: "delete",
      title: "Delete this backup?",
      description:
        "This deletes the backup configuration and its history rows. Files already on disk at the destination are not removed.",
      onDelete,
      isDeleting,
    },
  ]
}
