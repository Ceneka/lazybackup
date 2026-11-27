"use client"

import { HistoryRestoreButton } from "@/components/history-restore-button"
import { DeliveryBadge } from "@/components/peer/delivery-badge"
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
import {
  deliveryErrorFor,
  deriveDeliveryState,
  historyDisplayStats,
  peerIdForHistoryRow,
} from "@/lib/backup/delivery-state"
import { usePeers, type PeerSummary } from "@/lib/hooks/usePeers"
import { resolveFriendName } from "@/lib/peer/friend-copy"
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
  transferredSize?: number | null
  logOutput?: string | null
  mailboxPending?: boolean
  /** Contract C4 — optional until the delivery/reporting task lands. */
  deliveryState?: string | null
  deliveryError?: string | null
  mailboxError?: string | null
  artifactPath?: string | null
  artifactRemoved?: boolean | null
  backupConfig?: {
    id?: string
    name?: string | null
    sourceKind?: string | null
    sourceType?: string | null
    sourcePath?: string | null
    destinationKind?: string | null
    destinationPath?: string | null
    destinationPeerId?: string | null
    destinationPeer?: {
      id?: string | null
      name?: string | null
      kind?: "lazybro" | "lazybackup" | null
      remoteBaseUrl?: string | null
      online?: boolean | null
      lastSeenAt?: string | null
    } | null
    server?: { id?: string | null; name?: string | null } | null
    sourceS3Profile?: { name?: string | null } | null
    sourceGitRepo?: { name?: string | null } | null
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
  if (kind === "git") return item.backupConfig?.sourceGitRepo?.name || "Git"
  return item.backupConfig?.server?.name || "—"
}

export function historyFriendName(
  item: HistoryListItem,
  peers: readonly PeerSummary[] | undefined
): string {
  return resolveFriendName(peers, peerIdForHistoryRow({
    artifactPath: item.artifactPath,
    destinationPeerId: item.backupConfig?.destinationPeerId,
    destinationPeer: item.backupConfig?.destinationPeer,
  }))
}

function historyDeliveryState(item: HistoryListItem) {
  return deriveDeliveryState({
    status: item.status,
    deliveryState: item.deliveryState,
    mailboxPending: item.mailboxPending,
    deliveryError: item.deliveryError,
    mailboxError: item.mailboxError,
    artifactPath: item.artifactPath,
    artifactRemoved: (item as { artifactRemoved?: boolean | null }).artifactRemoved,
    destinationKind: item.backupConfig?.destinationKind,
  })
}

function statusBadge(item: HistoryListItem, peers: readonly PeerSummary[]) {
  const state = historyDeliveryState(item)
  if (state) {
    return (
      <DeliveryBadge
        state={state}
        friendName={historyFriendName(item, peers)}
        error={deliveryErrorFor({
          deliveryError: item.deliveryError,
          mailboxError: item.mailboxError,
        })}
      />
    )
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

function historyStats(item: HistoryListItem) {
  return historyDisplayStats({
    fileCount: item.fileCount,
    totalSize: item.totalSize,
    artifactPath: item.artifactPath,
    logOutput: item.logOutput,
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
  peers,
  isDeleting,
  deletingId,
  onDelete,
}: {
  items: HistoryListItem[]
  peers: readonly PeerSummary[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-3 md:hidden">
      {items.map((item) => {
        const stats = historyStats(item)
        const size = stats.sizeBytes != null ? formatBytes(stats.sizeBytes) : null
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
                  {stats.filesLabel && stats.isArchive ? ` · ${stats.filesLabel}` : ""}
                </p>
              </div>
              {statusBadge(item, peers)}
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
  peers,
  isDeleting,
  deletingId,
  onDelete,
}: {
  items: HistoryListItem[]
  peers: readonly PeerSummary[]
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
          {items.map((item) => {
            const stats = historyStats(item)
            return (
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
                <TableCell>{statusBadge(item, peers)}</TableCell>
                <TableCell>
                  {stats.sizeBytes != null ? formatBytes(stats.sizeBytes) : "-"}
                </TableCell>
                <TableCell className="text-right">
                  {stats.filesLabel ?? "-"}
                </TableCell>
                <TableCell className="text-right">
                  <HistoryEntryActions
                    item={item}
                    isDeleting={isDeleting}
                    deletingId={deletingId}
                    onDelete={onDelete}
                  />
                </TableCell>
              </TableRow>
            )
          })}
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
  const peersQuery = usePeers()
  const peers = peersQuery.data?.peers || []
  return (
    <>
      <HistoryCards
        items={items}
        peers={peers}
        isDeleting={isDeleting}
        deletingId={deletingId}
        onDelete={onDelete}
      />
      <HistoryTable
        items={items}
        peers={peers}
        isDeleting={isDeleting}
        deletingId={deletingId}
        onDelete={onDelete}
      />
    </>
  )
}
