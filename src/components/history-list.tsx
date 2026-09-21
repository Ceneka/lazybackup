"use client"

import { HistoryRestoreButton } from "@/components/history-restore-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  canRestoreBackup,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { cn, formatBytes } from "@/lib/utils"
import { format, formatDistance, formatDistanceToNow } from "date-fns"
import { ExternalLinkIcon } from "lucide-react"
import Link from "next/link"

export type HistoryListItem = {
  id: string
  startTime: string
  endTime?: string | null
  status: string
  fileCount?: number | null
  totalSize?: number | null
  mailboxPending?: boolean
  artifactPath?: string | null
  artifactRemoved?: boolean | null
  backupConfig?: {
    id?: string
    name?: string | null
    sourceKind?: string | null
    sourceType?: string | null
    sourcePath?: string | null
    destinationKind?: string | null
    server?: { id?: string | null; name?: string | null } | null
    sourceS3Profile?: { name?: string | null } | null
    destinationServer?: { authType?: string | null } | null
  } | null
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  success: "bg-green-500",
  failed: "bg-red-500",
}

function historyEndpointLabel(item: HistoryListItem): string {
  const kind = item.backupConfig?.sourceKind || "server"
  if (kind === "local") return "this host"
  if (kind === "s3") return item.backupConfig?.sourceS3Profile?.name || "S3"
  return item.backupConfig?.server?.name || "—"
}

function statusBadge(item: HistoryListItem) {
  if (item.mailboxPending) {
    return <Badge className="bg-amber-500">waiting for bro</Badge>
  }
  return (
    <Badge className={STATUS_COLORS[item.status] || "bg-gray-500"}>
      {item.status}
    </Badge>
  )
}

function durationLabel(item: HistoryListItem) {
  if (!item.endTime) {
    return <span className="text-muted-foreground">In progress</span>
  }
  return formatDistance(new Date(item.startTime), new Date(item.endTime), {
    includeSeconds: true,
  })
}

function HistoryEntryActions({
  item,
  isDeleting,
  deletingId,
  onDelete,
  className,
}: {
  item: HistoryListItem
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
  className?: string
}) {
  const showRestore = canRestoreBackup(restoreEligibilityFromHistory(item))
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {showRestore && <HistoryRestoreButton entry={item} />}
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/history/${item.id}`}>
          <ExternalLinkIcon className="h-3.5 w-3.5" />
          Open
        </Link>
      </Button>
      <DeleteConfirmationDialog
        title="Delete this history entry?"
        description="This deletes the history row only. Backup files on disk (if any) are left in place."
        isDeleting={isDeleting && deletingId === item.id}
        buttonText="Delete"
        onDelete={() => onDelete(item.id)}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </DeleteConfirmationDialog>
    </div>
  )
}

function HistoryCards({
  items,
  isDeleting,
  deletingId,
  onDelete,
}: {
  items: HistoryListItem[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-3 md:hidden">
      {items.map((item) => {
        const size = item.totalSize ? formatBytes(item.totalSize) : null
        return (
          <div
            key={item.id}
            className="relative rounded-lg border bg-card p-3 shadow-sm"
          >
            <Link
              href={`/history/${item.id}`}
              className="absolute inset-0 z-0 rounded-lg"
              aria-label={`Open ${item.backupConfig?.name || "backup"} history`}
            />
            <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {item.backupConfig?.name || "Unknown"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {historyEndpointLabel(item)}
                  {size ? ` · ${size}` : ""}
                </p>
              </div>
              {statusBadge(item)}
            </div>
            <div className="pointer-events-none relative z-10 mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <time dateTime={item.startTime} suppressHydrationWarning>
                {formatDistanceToNow(new Date(item.startTime), { addSuffix: true })}
              </time>
              <span>{durationLabel(item)}</span>
            </div>
            <div className="relative z-10 mt-2 border-t pt-2">
              <HistoryEntryActions
                item={item}
                isDeleting={isDeleting}
                deletingId={deletingId}
                onDelete={onDelete}
                className="justify-end"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HistoryTable({
  items,
  isDeleting,
  deletingId,
  onDelete,
}: {
  items: HistoryListItem[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
}) {
  return (
    <div className="hidden rounded-md border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Backup Config</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Files</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Link
                  href={`/history/${item.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {item.backupConfig?.name || "Unknown"}
                </Link>
              </TableCell>
              <TableCell>{historyEndpointLabel(item)}</TableCell>
              <TableCell>
                <div className="font-medium">
                  {format(new Date(item.startTime), "MMM d, yyyy")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {format(new Date(item.startTime), "h:mm a")}
                </div>
              </TableCell>
              <TableCell>{durationLabel(item)}</TableCell>
              <TableCell>{statusBadge(item)}</TableCell>
              <TableCell>
                {item.totalSize ? formatBytes(item.totalSize) : "-"}
              </TableCell>
              <TableCell className="text-right">{item.fileCount || "-"}</TableCell>
              <TableCell className="text-right">
                <HistoryEntryActions
                  item={item}
                  isDeleting={isDeleting}
                  deletingId={deletingId}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function HistoryList({
  items,
  isDeleting,
  deletingId,
  onDelete,
}: {
  items: HistoryListItem[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
}) {
  return (
    <>
      <HistoryCards
        items={items}
        isDeleting={isDeleting}
        deletingId={deletingId}
        onDelete={onDelete}
      />
      <HistoryTable
        items={items}
        isDeleting={isDeleting}
        deletingId={deletingId}
        onDelete={onDelete}
      />
    </>
  )
}
