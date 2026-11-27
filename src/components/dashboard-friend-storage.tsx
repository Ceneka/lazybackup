"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { deriveDeliveryState } from "@/lib/backup/delivery-state"
import { useHistoryList } from "@/lib/hooks/useHistory"
import { usePeers, type PeerSummary } from "@/lib/hooks/usePeers"
import { friendIsOnline, resolveFriendName } from "@/lib/peer/friend-copy"
import { cn } from "@/lib/utils"
import { UsersIcon } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import Link from "next/link"

function activePeerList(peers: PeerSummary[] | undefined): PeerSummary[] {
  return (peers || []).filter((peer) => peer.status === "active")
}

type HistoryRowLike = {
  startTime: string
  status?: string | null
  mailboxPending?: boolean | null
  deliveryState?: string | null
  artifactPath?: string | null
  backupConfig?: { destinationKind?: string | null } | null
}

function rowDeliveryState(entry: HistoryRowLike) {
  return deriveDeliveryState({
    status: entry.status,
    deliveryState: entry.deliveryState,
    mailboxPending: entry.mailboxPending,
    artifactPath: entry.artifactPath,
    artifactRemoved: (entry as { artifactRemoved?: boolean | null }).artifactRemoved,
    destinationKind: entry.backupConfig?.destinationKind,
  })
}

/**
 * Small dashboard presence card for Bro Space. "Off-site" is derived from the
 * delivered state only — waiting runs are never counted as stored copies.
 */
export function DashboardFriendStorage() {
  const peersQuery = usePeers()
  const historyQuery = useHistoryList({}, { limit: 30, offset: 0 })
  const peers = activePeerList(peersQuery.data?.peers)

  if (peersQuery.isLoading) return null

  if (peers.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Friend storage
          </CardTitle>
          <CardDescription>
            Back up to a friend&apos;s computer for an off-site copy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            No friend is connected yet. Invite one in Bro Space — files are
            encrypted before they leave this server.
          </p>
          <Link
            href="/settings?tab=bro"
            className="text-primary underline underline-offset-2"
          >
            Set up Bro Space
          </Link>
        </CardContent>
      </Card>
    )
  }

  const onlineCount = peers.filter((peer) => friendIsOnline(peer) === true).length
  const peerError = peers
    .map((peer) => peer.remoteLastError?.trim())
    .find((value): value is string => Boolean(value))
  const historyRows = (historyQuery.data?.history || []) as HistoryRowLike[]
  const waitingFromHistory = historyRows.filter(
    (row) => rowDeliveryState(row) === "waiting"
  ).length
  const pendingFromPeers = peers.reduce(
    (sum, peer) => sum + (typeof peer.pendingSyncCount === "number" ? peer.pendingSyncCount : 0),
    0
  )
  const waitingCount = Math.max(pendingFromPeers, waitingFromHistory)

  const storedRows = historyRows.filter((row) => rowDeliveryState(row) === "stored")
  const failedCount = historyRows.filter((row) => rowDeliveryState(row) === "failed").length
  const lastStored = storedRows[0]
  const friend = peers[0]!
  const friendName = resolveFriendName(peers, friend.id)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5" />
              Friend storage
            </CardTitle>
            <CardDescription>
              {peers.length === 1
                ? `Off-site copy on ${friendName}'s computer`
                : `${peers.length} friends lending disk space`}
            </CardDescription>
          </div>
          <Link
            href="/settings?tab=bro"
            className="text-sm text-primary underline underline-offset-2"
          >
            Manage
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              onlineCount > 0 ? "bg-emerald-500" : "bg-amber-500"
            )}
            aria-hidden
          />
          <span>
            {onlineCount === 0
              ? "No friend is online right now"
              : `${onlineCount} of ${peers.length} online`}
          </span>
        </p>
        <p className={waitingCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
          {waitingCount === 0
            ? failedCount > 0
              ? "No backups are waiting"
              : "Everything is delivered"
            : `${waitingCount} backup${waitingCount === 1 ? "" : "s"} waiting to reach a friend`}
        </p>
        {failedCount > 0 ? (
          <p className="text-red-600 dark:text-red-400">
            {failedCount} recent backup{failedCount === 1 ? "" : "s"} could not be
            delivered
          </p>
        ) : null}
        {peerError ? (
          <p className="text-red-600 dark:text-red-400" title={peerError}>
            A friend&apos;s app reported a delivery problem
          </p>
        ) : null}
        <p className="text-muted-foreground" suppressHydrationWarning>
          Last off-site copy:{" "}
          {lastStored
            ? `${formatDistanceToNow(new Date(lastStored.startTime), {
                addSuffix: true,
              })}`
            : "none in recent history"}
          {storedRows.length > 0
            ? ` · ${storedRows.length} stored in recent runs`
            : ""}
        </p>
        <div className="pt-1">
          <Link
            href={`/backups/new?recipe=bro-peer&peerId=${encodeURIComponent(friend.id)}`}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back up to {friendName}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
