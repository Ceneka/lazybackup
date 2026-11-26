/** A peer is "online" when its app checked in during this window. */
export const PEER_ONLINE_WINDOW_MS = 90_000

export type PeerStatusTone =
  | "online"
  | "idle"
  | "never"
  | "attention"
  | "revoked"

export type PeerStatus = {
  tone: PeerStatusTone
  label: string
  /** Whether the friend can receive a new backup right now (best effort). */
  reachable: boolean
}

export type PeerStatusInput = {
  status?: string | null
  online?: boolean | null
  lastSeenAt?: string | Date | null
  remoteLastError?: string | null
  pendingSyncCount?: number | null
}

function toTime(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** "just now", "12 minutes ago", "2 hours ago", "3 days ago". */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: number = Date.now()
): string | null {
  const time = toTime(value)
  if (time === null) return null
  const elapsed = Math.max(0, now - time)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

/**
 * Status chip for a friend card.
 *
 * Priority: revoked → reported error → online → last-seen → never.
 * `online` from the API wins when present, but a stale `lastSeenAt` is still
 * rendered as a relative label instead of a raw ISO timestamp.
 */
export function derivePeerStatus(
  peer: PeerStatusInput,
  now: number = Date.now()
): PeerStatus {
  if (peer.status === "revoked") {
    return { tone: "revoked", label: "Disconnected", reachable: false }
  }
  if (peer.remoteLastError) {
    return { tone: "attention", label: "Needs attention", reachable: false }
  }

  const lastSeen = toTime(peer.lastSeenAt)
  const seenRecently =
    lastSeen !== null && Math.max(0, now - lastSeen) <= PEER_ONLINE_WINDOW_MS
  const isOnline = typeof peer.online === "boolean" ? peer.online : seenRecently

  if (isOnline) {
    return { tone: "online", label: "Online now", reachable: true }
  }
  if (lastSeen !== null) {
    return {
      tone: "idle",
      label: `Last seen ${formatRelativeTime(lastSeen, now) ?? "a while ago"}`,
      reachable: false,
    }
  }
  return { tone: "never", label: "Never connected", reachable: false }
}

const FULL_PATTERNS = [/quota/i, /folder is full/i, /no space/i, /disk full/i]
const UNREACHABLE_PATTERNS = [
  /fetch failed/i,
  /failed to fetch/i,
  /unreachable/i,
  /econnrefused/i,
  /econnreset/i,
  /timed? out/i,
  /timeout/i,
  /offline/i,
  /network/i,
]
const AUTH_PATTERNS = [/\b401\b/, /\b403\b/, /unauthorized/i, /forbidden/i]

/**
 * Never show raw parser/transport text as the headline. Returns one friend-safe
 * sentence; the raw value can live behind a Details disclosure.
 */
export function humanizePeerError(
  raw: string | null | undefined,
  friendName: string
): string | null {
  const message = (raw ?? "").trim()
  if (!message) return null
  const friend = friendName.trim() || "Your friend"

  if (FULL_PATTERNS.some((pattern) => pattern.test(message))) {
    return `${friend}’s folder is full`
  }
  if (UNREACHABLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return `Couldn’t reach ${friend}’s computer`
  }
  if (AUTH_PATTERNS.some((pattern) => pattern.test(message))) {
    return `${friend}’s app no longer accepts this connection`
  }
  return `${friend}’s app reported a problem`
}

/** Peer type label without making the UI guess in several places. */
export function peerKindLabel(peer: {
  kind?: "lazybro" | "lazybackup" | null
  remoteBaseUrl?: string | null
}): string {
  if (peer.kind === "lazybro") return "LazyBro app"
  if (peer.kind === "lazybackup") return "LazyBackup"
  return peer.remoteBaseUrl ? "LazyBackup" : "LazyBro app"
}
