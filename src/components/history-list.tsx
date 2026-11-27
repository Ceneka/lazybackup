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
  destinationEndpointName,
  sourceEndpointName,
} from "@/lib/backup/endpoint-display"
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
import { formatCount, formatDuration } from "@/lib/format/duration"
import { usePeers, type PeerSummary } from "@/lib/hooks/usePeers"
import { resolveFriendName } from "@/lib/peer/friend-copy"
import { cn, formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  XCircleIcon,
} from "lucide-react"
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
    sourceKind?: "local" | "server" | "s3" | "git" | null
    sourceType?:
      | "path"
      | "docker_volume"
      | "database"
      | "lazybackup_instance"
      | "git_repo"
      | null
    sourcePath?: string | null
    destinationKind?: "local" | "server" | "s3" | "peer" | null
    destinationPath?: string | null
    destinationPeerId?: string | null
    destinationPeer?: {
      id?: string | null
      name: string
      kind?: "lazybro" | "lazybackup" | null
      remoteBaseUrl?: string | null
      online?: boolean | null
      lastSeenAt?: string | null
    } | null
    dbEngine?: string | null
    server?: { id?: string | null; name: string } | null
    destinationServer?: {
      id?: string | null
      name: string
      authType?: string | null
    } | null
    sourceS3Profile?: { name: string } | null
    destinationS3Profile?: { name: string } | null
    sourceGitRepo?: { name: string } | null
  } | null
}

export function historyFriendName(
  item: HistoryListItem,
  peers: readonly PeerSummary[] | undefined
): string {
  return resolveFriendName(
    peers,
    peerIdForHistoryRow({
      artifactPath: item.artifactPath,
      destinationPeerId: item.backupConfig?.destinationPeerId,
      destinationPeer: item.backupConfig?.destinationPeer,
    })
  )
}

function historyDeliveryState(item: HistoryListItem) {
  return deriveDeliveryState({
    status: item.status,
    deliveryState: item.deliveryState,
    mailboxPending: item.mailboxPending,
    deliveryError: item.deliveryError,
    mailboxError: item.mailboxError,
    artifactPath: item.artifactPath,
    artifactRemoved: item.artifactRemoved,
    destinationKind: item.backupConfig?.destinationKind,
  })
}

function runStatusBadge(status: string) {
  if (status === "running") {
    return (
      <Badge variant="info" className="gap-1">
        <ClockIcon className="h-3 w-3" aria-hidden />
        running
      </Badge>
    )
  }
  if (status === "success") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2Icon className="h-3 w-3" aria-hidden />
        success
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge
        variant="destructive"
        className="gap-1 border-transparent bg-red-500/15 text-red-700 ring-1 ring-inset ring-red-500/30 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/25"
      >
        <XCircleIcon className="h-3 w-3" aria-hidden />
        failed
      </Badge>
    )
  }
  return (
    <Badge variant="muted" className="gap-1">
      <CircleIcon className="h-3 w-3" aria-hidden />
      {status}
    </Badge>
  )
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
    <div className="flex flex-wrap items-center justify-end gap-1">
      {runStatusBadge(item.status)}
    </div>
  )
}

function endpointsLabel(item: HistoryListItem): string {
  const config = item.backupConfig
  if (!config) return "—"
  return `${sourceEndpointName(config)} → ${destinationEndpointName(config)}`
}

function durationLabel(item: HistoryListItem) {
  if (!item.endTime) {
    return (
      <span className="text-muted-foreground">
        {item.status === "running" ? "In progress" : "—"}
      </span>
    )
  }
  const start = new Date(item.startTime).getTime()
  const end = new Date(item.endTime).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span title={`${format(new Date(start), "PPpp")} – ${format(new Date(end), "PPpp")}`}>
      {formatDuration(end - start)}
    </span>
  )
}

function historyDetailHref(id: string, returnQuery?: string): string {
  if (!returnQuery) return `/history/${id}`
  return `/history/${id}?returnTo=${encodeURIComponent(`/history?${returnQuery}`)}`
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
  returnQuery,
  className,
}: {
  item: HistoryListItem
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
  returnQuery?: string
  className?: string
}) {
  const showRestore = canRestoreBackup(restoreEligibilityFromHistory(item))
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {showRestore && <HistoryRestoreButton entry={item} />}
      <Button variant="ghost" size="sm" asChild>
        <Link href={historyDetailHref(item.id, returnQuery)}>
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
  returnQuery,
}: {
  items: HistoryListItem[]
  peers: readonly PeerSummary[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
  returnQuery?: string
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
              href={historyDetailHref(item.id, returnQuery)}
              className="absolute inset-0 z-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Open ${item.backupConfig?.name || "backup"} history`}
            />
            <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {item.backupConfig?.name || "Unknown"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {endpointsLabel(item)}
                  {size ? ` · ${size}` : ""}
                  {stats.filesLabel && stats.isArchive ? ` · ${stats.filesLabel}` : ""}
                </p>
              </div>
              {statusBadge(item, peers)}
            </div>
            <div className="pointer-events-none relative z-10 mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <time
                dateTime={item.startTime}
                title={format(new Date(item.startTime), "PPpp")}
                suppressHydrationWarning
              >
                {format(new Date(item.startTime), "MMM d, h:mm a")}
              </time>
              <span>{durationLabel(item)}</span>
            </div>
            <div className="relative z-10 mt-2 border-t pt-2">
              <HistoryEntryActions
                item={item}
                isDeleting={isDeleting}
                deletingId={deletingId}
                onDelete={onDelete}
                returnQuery={returnQuery}
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
  returnQuery,
}: {
  items: HistoryListItem[]
  peers: readonly PeerSummary[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
  returnQuery?: string
}) {
  return (
    <div className="hidden rounded-md border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Backup Config</TableHead>
            <TableHead>From → To</TableHead>
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
                    href={historyDetailHref(item.id, returnQuery)}
                    className="font-medium text-primary hover:underline"
                  >
                    {item.backupConfig?.name || "Unknown"}
                  </Link>
                </TableCell>
                <TableCell>
                  {item.backupConfig ? (
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">
                        {sourceEndpointName(item.backupConfig)}
                      </span>
                      <ArrowRightIcon
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate text-muted-foreground">
                        {destinationEndpointName(item.backupConfig)}
                      </span>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
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
                  {stats.sizeBytes != null ? formatBytes(stats.sizeBytes) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {stats.filesLabel ??
                    (item.fileCount != null ? formatCount(item.fileCount) : "—")}
                </TableCell>
                <TableCell className="text-right">
                  <HistoryEntryActions
                    item={item}
                    isDeleting={isDeleting}
                    deletingId={deletingId}
                    onDelete={onDelete}
                    returnQuery={returnQuery}
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
  returnQuery,
}: {
  items: HistoryListItem[]
  isDeleting: boolean
  deletingId: string | null
  onDelete: (id: string) => void
  /** Current list query string, preserved on the detail page's Back action. */
  returnQuery?: string
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
        returnQuery={returnQuery}
      />
      <HistoryTable
        items={items}
        peers={peers}
        isDeleting={isDeleting}
        deletingId={deletingId}
        onDelete={onDelete}
        returnQuery={returnQuery}
      />
    </>
  )
}
