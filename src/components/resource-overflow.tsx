"use client"

import { OverflowMenu, type OverflowItem } from "@/components/overflow-menu"
import type { useResourceQuickActions } from "@/lib/resource-actions"
import {
  CableIcon,
  CopyIcon,
  EyeIcon,
  FolderPlusIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  TrashIcon,
} from "lucide-react"
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
    {
      type: "link",
      href: `/backups/new?s3ProfileId=${id}`,
      label: "Create backup",
      icon: FolderPlusIcon,
    },
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

export function gitOverflowItems(opts: {
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
      label: actions.isBusy(`git:${id}`) ? "Testing…" : "Test connection",
      icon: CableIcon,
      disabled: actions.isBusy(`git:${id}`),
      onSelect: () => void actions.testGit(id, name),
    },
    { type: "link", href: `/git-repos/${id}`, label: "View", icon: EyeIcon },
    {
      type: "link",
      href: `/backups/new?gitRepoId=${id}`,
      label: "Create backup",
      icon: FolderPlusIcon,
    },
    { type: "separator" },
    {
      type: "delete",
      title: "Delete this Git repository?",
      description: "This cannot be undone. Repositories used by backups cannot be deleted.",
      onDelete,
      isDeleting,
    },
  ]
}

export function backupOverflowItems(opts: {
  id: string
  name: string
  enabled?: boolean
  /** A run for this config is in flight — Delete is blocked server-side safety. */
  running?: boolean
  actions: QuickActions
  onToggle?: () => void
  isToggling?: boolean
  onDelete: () => void
  isDeleting: boolean
}): OverflowItem[] {
  const {
    id,
    name,
    enabled = true,
    running = false,
    actions,
    onToggle,
    isToggling = false,
    onDelete,
    isDeleting,
  } = opts
  const toggleLabel = enabled ? "Pause" : "Resume"
  return [
    {
      type: "action",
      label: running
        ? "Running…"
        : actions.isBusy(`backup:${id}`)
          ? "Running"
          : "Run now",
      icon: PlayIcon,
      disabled: running || actions.isBusy(`backup:${id}`),
      onSelect: () => void actions.runBackup(id),
    },
    ...(onToggle
      ? [
          {
            type: "action" as const,
            label: isToggling ? "Updating…" : toggleLabel,
            icon: enabled ? PauseIcon : PlayIcon,
            disabled: isToggling || actions.isBusy(`backup:${id}`),
            onSelect: onToggle,
          },
        ]
      : []),
    { type: "link", href: `/backups/${id}`, label: "View", icon: EyeIcon },
    {
      type: "link",
      href: `/backups/new?cloneFrom=${id}`,
      label: "Clone",
      icon: CopyIcon,
    },
    { type: "separator" },
    ...(running
      ? [
          {
            type: "action" as const,
            label: "Delete — run in progress",
            icon: TrashIcon,
            disabled: true,
            onSelect: () => {},
          },
        ]
      : [
          {
            type: "delete" as const,
            title: `Delete “${name}”?`,
            description:
              "This deletes the backup configuration and its history and restore entries. Files stay at the destination, but they can no longer be restored through LazyBackup.",
            onDelete,
            isDeleting,
          },
        ]),
  ]
}
