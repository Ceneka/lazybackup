/**
 * Composite delivery state for Bro Space (contract C4).
 *
 * A peer backup is `success` as soon as it is staged on this host, but it is
 * only truly off-site once the friend's app pulls it and ACKs. The UI must not
 * present the staged copy as "stored on the friend's disk".
 */

import {
  friendAppLabel,
  friendPossessive,
  isPeerArtifactPath,
  peerIdFromArtifactPath,
  type FriendAppKind,
} from '@/lib/peer/friend-copy'
import { parseArchiveTransferStats } from './log-format'

export type DeliveryState = 'stored' | 'waiting' | 'failed' | null

export type DeliveryStateInput = {
  status?: string | null
  /** Contract C4; absent on older payloads. */
  deliveryState?: string | null
  mailboxPending?: boolean | null
  /** Contract C4 optional reason (older payloads may use mailboxError). */
  deliveryError?: string | null
  mailboxError?: string | null
  artifactPath?: string | null
  destinationKind?: string | null
  /** Artifact gone (retention / friend removed): make no delivery claim. */
  artifactRemoved?: boolean | null
}

export function normalizeDeliveryState(value: unknown): DeliveryState {
  return value === 'stored' || value === 'waiting' || value === 'failed'
    ? value
    : null
}

export function isPeerDestination(input: {
  destinationKind?: string | null
  artifactPath?: string | null
}): boolean {
  return input.destinationKind === 'peer' || isPeerArtifactPath(input.artifactPath)
}

/**
 * Prefer C4's `deliveryState`; fall back to `mailboxPending` for older APIs.
 * Returns null for non-peer destinations and for runs that never finished.
 */
export function deriveDeliveryState(input: DeliveryStateInput): DeliveryState {
  if (input.status === 'running') return null
  if (input.artifactRemoved) return null
  if (!isPeerDestination(input)) return null
  // A delivery state only describes a finished, successful peer run whose
  // artifact is actually a peer blob. An explicit (possibly stale) payload
  // must not make a failed run, or a local run whose config was later pointed
  // at a friend, look stored off-site.
  if (input.status && input.status !== 'success') return null
  if (!isPeerArtifactPath(input.artifactPath)) return null
  const explicit = normalizeDeliveryState(input.deliveryState)
  if (explicit) return explicit
  return input.mailboxPending ? 'waiting' : 'stored'
}

export function deliveryErrorFor(input: DeliveryStateInput): string | null {
  const reason = input.deliveryError ?? input.mailboxError
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  return trimmed || null
}

export type DeliveryBadgeTone = 'success' | 'warning' | 'error'

export type DeliveryBadgeCopy = {
  label: string
  title: string
  tone: DeliveryBadgeTone
}

export function deliveryBadgeCopy(input: {
  state: DeliveryState
  friendName: string
  error?: string | null
}): DeliveryBadgeCopy | null {
  const friend = input.friendName.trim() || 'your friend'
  const possessive = friendPossessive(friend)
  if (input.state === 'stored') {
    return {
      label: `Stored on ${possessive} disk`,
      title: `This backup is stored off-site on ${possessive} computer.`,
      tone: 'success',
    }
  }
  if (input.state === 'waiting') {
    return {
      label: `Waiting for ${friend}`,
      title: `Saved on this server. Not yet on ${possessive} disk.`,
      tone: 'warning',
    }
  }
  if (input.state === 'failed') {
    const reason = input.error?.trim()
    return {
      label: `Could not deliver to ${friend}`,
      title: reason
        ? `Could not deliver to ${friend}: ${reason}`
        : `This backup did not reach ${possessive} disk.`,
      tone: 'error',
    }
  }
  return null
}

export type DeliveryToast = {
  variant: 'success' | 'info' | 'error'
  title: string
  description?: string
}

/**
 * Toast copy for a finished run. Waiting peer runs are info, never success —
 * the artifact is still only on this host.
 */
export function backupFinishedToast(input: {
  state: DeliveryState
  friendName: string
  kind?: FriendAppKind | null
  error?: string | null
}): DeliveryToast | null {
  const friend = input.friendName.trim() || 'your friend'
  const possessive = friendPossessive(friend)
  if (input.state === 'waiting') {
    return {
      variant: 'info',
      title: `Saved on this server — waiting for ${possessive} ${friendAppLabel(input.kind)}`,
      description: `It will be stored once ${friendAppLabel(input.kind)} checks in. Keep it running.`,
    }
  }
  if (input.state === 'stored') {
    return {
      variant: 'success',
      title: `Stored on ${possessive} disk`,
    }
  }
  if (input.state === 'failed') {
    const reason = input.error?.trim()
    return {
      variant: 'error',
      title: `Could not deliver to ${friend}`,
      description: reason || undefined,
    }
  }
  return null
}

export type HistoryStatsInput = {
  fileCount?: number | null
  totalSize?: number | null
  artifactPath?: string | null
  logOutput?: string | null
}

export type HistoryStats = {
  sizeBytes: number | null
  filesLabel: string | null
  /** True when the fallback came from a single-archive log line. */
  isArchive: boolean
}

function looksLikeArchiveArtifact(artifactPath: string | null | undefined): boolean {
  if (!artifactPath) return false
  const path = artifactPath.toLowerCase()
  return (
    path.endsWith('.tar.gz') ||
    path.endsWith('.tgz') ||
    path.endsWith('.sql.gz') ||
    path.endsWith('.sqlite.gz') ||
    path.endsWith('.age')
  )
}

/**
 * Size/files for history rows. Single-archive backups (peer path archives,
 * volume/database dumps, encrypted trees) store no rsync stats, so parse the
 * `Size: N bytes` line the backup log already contains (B9).
 */
export function historyDisplayStats(input: HistoryStatsInput): HistoryStats {
  const archive = looksLikeArchiveArtifact(input.artifactPath)
  if (typeof input.totalSize === 'number' && input.totalSize >= 0) {
    return {
      sizeBytes: input.totalSize,
      filesLabel:
        typeof input.fileCount === 'number' && input.fileCount >= 0
          ? String(input.fileCount)
          : archive
            ? '1 archive'
            : null,
      isArchive: archive,
    }
  }
  if (archive) {
    const parsed = input.logOutput
      ? parseArchiveTransferStats(input.logOutput)
      : null
    if (parsed) {
      return { sizeBytes: parsed.totalSize, filesLabel: '1 archive', isArchive: true }
    }
    return { sizeBytes: null, filesLabel: '1 archive', isArchive: true }
  }
  return {
    sizeBytes:
      typeof input.totalSize === 'number' && input.totalSize >= 0
        ? input.totalSize
        : null,
    filesLabel:
      typeof input.fileCount === 'number' && input.fileCount >= 0
        ? String(input.fileCount)
        : null,
    isArchive: false,
  }
}

export function peerIdForHistoryRow(input: {
  artifactPath?: string | null
  destinationPeerId?: string | null
  destinationPeer?: { id?: string | null } | null
}): string | null {
  return (
    input.destinationPeerId ||
    input.destinationPeer?.id ||
    peerIdFromArtifactPath(input.artifactPath) ||
    null
  )
}
