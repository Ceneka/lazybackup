/**
 * Friend-facing labels and restore copy for Bro Space peers.
 *
 * Everything in this module is pure so the UI can be unit-tested and so the
 * same words are used by badges, toasts, history and the restore dialog.
 * Product language: "friend", never "bro/peer/mailbox" in primary copy.
 */

export type FriendAppKind = 'lazybro' | 'lazybackup'

export const FRIEND_FALLBACK_NAME = 'your friend'

/** Presence window used by contract C1 (`online`), duplicated here for old payloads. */
export const PEER_ONLINE_WINDOW_MS = 90_000

/** After this long, tell the user it is safe to close the dialog. */
export const RECALL_CLOSE_HINT_AFTER_MS = 90_000

/** Stop client polling after this long; the recall stays queued server-side. */
export const RECALL_MAX_POLL_MS = 5 * 60_000

export type FriendPeerLike = {
  id?: string | null
  name?: string | null
  status?: string | null
  kind?: FriendAppKind | null
  online?: boolean | null
  lastSeenAt?: string | Date | null
  remoteBaseUrl?: string | null
}

/** `peer://<peerId>/<objectKey>` → `<peerId>` (null for other artifact paths). */
export function peerIdFromArtifactPath(
  artifactPath: string | null | undefined
): string | null {
  if (!artifactPath) return null
  const trimmed = artifactPath.trim()
  const prefix = 'peer://'
  if (!trimmed.toLowerCase().startsWith(prefix)) return null
  const rest = trimmed.slice(prefix.length)
  const id = rest.split('/')[0]?.trim()
  return id ? id : null
}

/** Object key (folder + file) inside a `peer://` artifact path. */
export function peerObjectKeyFromArtifactPath(
  artifactPath: string | null | undefined
): string | null {
  if (!artifactPath) return null
  const trimmed = artifactPath.trim()
  const prefix = 'peer://'
  if (!trimmed.toLowerCase().startsWith(prefix)) return null
  const rest = trimmed.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const key = rest.slice(slash + 1).replace(/^\/+/, '')
  return key || null
}

export function resolvePeer<T extends FriendPeerLike>(
  peers: readonly T[] | null | undefined,
  peerId?: string | null
): T | null {
  if (!peers || peers.length === 0) return null
  if (peerId) {
    return peers.find((peer) => peer.id === peerId) ?? null
  }
  // 1:1 product: with no id, only guess when there is exactly one friend.
  const active = peers.filter((peer) => !peer.status || peer.status === 'active')
  return active.length === 1 ? active[0] : null
}

/**
 * Friend name for a run/config. Exact peer id wins; with no id, a lone active
 * peer is used. Never leak ids or "peer" into UI copy.
 */
export function resolveFriendName(
  peers: readonly FriendPeerLike[] | null | undefined,
  peerId?: string | null,
  fallback: string = FRIEND_FALLBACK_NAME
): string {
  const peer = resolvePeer(peers, peerId)
  const name = peer?.name?.trim()
  return name || fallback
}

export function friendPossessive(name: string): string {
  const trimmed = name.trim() || FRIEND_FALLBACK_NAME
  return trimmed.endsWith('s') ? `${trimmed}'` : `${trimmed}'s`
}

/** Contract C1 `kind`, inferred from the legacy `remoteBaseUrl` when absent. */
export function friendAppKind(
  peer: Pick<FriendPeerLike, 'kind' | 'remoteBaseUrl'> | null | undefined
): FriendAppKind {
  if (peer?.kind === 'lazybro' || peer?.kind === 'lazybackup') return peer.kind
  return peer?.remoteBaseUrl ? 'lazybackup' : 'lazybro'
}

export function friendAppLabel(kind: FriendAppKind | null | undefined): string {
  return kind === 'lazybackup' ? 'LazyBackup' : 'LazyBro'
}

/**
 * Contract C1 `online` with a last-seen fallback (90 s window).
 * `null` means we cannot tell (no report yet).
 */
export function friendIsOnline(
  peer:
    | Pick<FriendPeerLike, 'online' | 'lastSeenAt'>
    | null
    | undefined,
  now: number = Date.now()
): boolean | null {
  if (!peer) return null
  if (typeof peer.online === 'boolean') return peer.online
  if (!peer.lastSeenAt) return null
  const seen = new Date(peer.lastSeenAt).getTime()
  if (!Number.isFinite(seen)) return null
  return now - seen <= PEER_ONLINE_WINDOW_MS
}

export function isPeerArtifactPath(
  artifactPath: string | null | undefined
): boolean {
  return peerIdFromArtifactPath(artifactPath) !== null
}

export type RestoreStageId = 'asking' | 'downloading' | 'restoring'

export type RestoreStage = {
  id: RestoreStageId
  label: string
}

export function restoreStages(
  friendName: string,
  kind: FriendAppKind | null | undefined
): RestoreStage[] {
  const app = friendAppLabel(kind)
  const friend = friendName.trim() || FRIEND_FALLBACK_NAME
  return [
    { id: 'asking', label: `Asking ${friendPossessive(friend)} ${app} for the backup` },
    { id: 'downloading', label: 'Downloading the backup to this server' },
    { id: 'restoring', label: 'Restoring to the target' },
  ]
}

export type RestorePreflightInput = {
  friendName: string
  kind?: FriendAppKind | null
  online?: boolean | null
  /** True when the run is still waiting to reach the friend's disk. */
  waitingForDelivery?: boolean
}

export type RestorePreflight = {
  tone: 'info' | 'warning'
  title: string
  detail: string
  primaryLabel: string
}

/**
 * Dialog preflight shown before a peer recall starts. Offline is not an error:
 * the recall stays queued until the friend's app checks in.
 */
export function restorePreflightCopy(
  input: RestorePreflightInput
): RestorePreflight | null {
  const friend = input.friendName.trim() || FRIEND_FALLBACK_NAME
  const app = friendAppLabel(input.kind)
  if (input.online === false) {
    return {
      tone: 'warning',
      title: `${friendPossessive(friend)} ${app} is offline.`,
      detail:
        app === 'LazyBackup'
          ? `We'll ask for the backup when ${friend}'s LazyBackup syncs again. It can take a few minutes.`
          : `We'll ask for the backup when LazyBro checks in again (every ~45 seconds). Keep LazyBro open on ${friend}'s computer.`,
      primaryLabel: 'Request backup',
    }
  }
  if (input.waitingForDelivery) {
    return {
      tone: 'info',
      title: `This backup hasn't reached ${friendPossessive(friend)} disk yet.`,
      detail: `It is saved safely on this server. Restore will wait for ${friend}'s ${app} to sync it first.`,
      primaryLabel: 'Request backup',
    }
  }
  return null
}

export type RestoreWaitingCopy = {
  headline: string
  detail: string
  closeHint: string | null
}

/**
 * Copy shown while a recall is pending. `elapsedMs` drives the "you can close
 * this" hint; `online` false gets a distinct explanation instead of a spinner
 * that looks stuck.
 */
export function restoreWaitingCopy(input: {
  friendName: string
  kind?: FriendAppKind | null
  online?: boolean | null
  elapsedMs: number
}): RestoreWaitingCopy {
  const friend = input.friendName.trim() || FRIEND_FALLBACK_NAME
  const app = friendAppLabel(input.kind)
  const closeHint =
    input.elapsedMs >= RECALL_CLOSE_HINT_AFTER_MS
      ? 'You can close this — the request stays queued; check History later.'
      : null

  if (input.online === false) {
    return {
      headline:
        app === 'LazyBackup'
          ? `Waiting for ${friendPossessive(friend)} LazyBackup to sync`
          : `Waiting for ${friendPossessive(friend)} LazyBro to check in`,
      detail:
        app === 'LazyBackup'
          ? `Their LazyBackup will send the backup on its next sync.`
          : `It checks in every ~45 seconds. Keep LazyBro open on ${friend}'s computer.`,
      closeHint,
    }
  }

  if (app === 'LazyBackup') {
    return {
      headline: `Waiting for ${friendPossessive(friend)} LazyBackup to send it back`,
      detail: 'Their instance checks for queued requests on its next sync.',
      closeHint,
    }
  }

  return {
    headline: `Asking ${friendPossessive(friend)} LazyBro…`,
    detail: `It checks in every ~45 seconds. Keep LazyBro open on ${friend}'s computer.`,
    closeHint,
  }
}

/** Client-side recall polling should stop after a sane max, not forever. */
export function shouldStopRecallPolling(elapsedMs: number): boolean {
  return elapsedMs >= RECALL_MAX_POLL_MS
}

/** mm:ss for elapsed-time labels (never negative). */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
