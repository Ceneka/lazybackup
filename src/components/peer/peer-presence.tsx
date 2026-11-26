"use client"

import {
  friendAppKind,
  friendAppLabel,
  friendIsOnline,
  type FriendPeerLike,
} from "@/lib/peer/friend-copy"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

/**
 * Online / last-seen line for a Bro Space friend (contract C1 fields with a
 * lastSeenAt fallback). Read-only: the peers hook owns refreshing.
 */
export function PeerPresence({
  peer,
  className,
  showApp = true,
}: {
  peer: FriendPeerLike | null | undefined
  className?: string
  showApp?: boolean
}) {
  if (!peer) return null
  const online = friendIsOnline(peer)
  const lastSeen = peer.lastSeenAt ? new Date(peer.lastSeenAt) : null
  const validLastSeen = lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen : null
  const app = friendAppLabel(friendAppKind(peer))

  const label =
    online === true
      ? "Online now"
      : online === false
        ? validLastSeen
          ? `Last seen ${formatDistanceToNow(validLastSeen, { addSuffix: true })}`
          : "Offline"
        : "Waiting for the first check-in"

  return (
    <p
      className={cn("flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <span
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full",
          online === true
            ? "bg-emerald-500"
            : online === false
              ? "bg-amber-500"
              : "bg-muted-foreground/40"
        )}
        aria-hidden
      />
      <span suppressHydrationWarning>{label}</span>
      {showApp ? <span className="text-muted-foreground/70">· {app} app</span> : null}
    </p>
  )
}
