import { describe, expect, test } from 'bun:test'
import {
  FRIEND_FALLBACK_NAME,
  friendAppKind,
  friendAppLabel,
  friendIsOnline,
  friendPossessive,
  formatElapsed,
  peerIdFromArtifactPath,
  peerObjectKeyFromArtifactPath,
  RECALL_CLOSE_HINT_AFTER_MS,
  RECALL_MAX_POLL_MS,
  resolveFriendName,
  resolvePeer,
  restorePreflightCopy,
  restoreStages,
  restoreWaitingCopy,
  shouldStopRecallPolling,
} from './friend-copy'

const peers = [
  { id: 'p1', name: 'Alex', status: 'active', remoteBaseUrl: '' },
  { id: 'p2', name: 'Sam', status: 'active', remoteBaseUrl: 'https://sam.example' },
]

describe('peer artifact paths', () => {
  test('extracts the peer id and object key', () => {
    expect(peerIdFromArtifactPath('peer://p1/backups/docs/app.tar.gz.age')).toBe('p1')
    expect(peerObjectKeyFromArtifactPath('peer://p1/backups/docs/app.tar.gz.age')).toBe(
      'backups/docs/app.tar.gz.age'
    )
  })

  test('returns null for non-peer or malformed paths', () => {
    expect(peerIdFromArtifactPath('/backups/local/file.tar.gz')).toBeNull()
    expect(peerIdFromArtifactPath('peer://')).toBeNull()
    expect(peerIdFromArtifactPath(null)).toBeNull()
    expect(peerObjectKeyFromArtifactPath('peer://p1')).toBeNull()
  })
})

describe('friend-name resolution', () => {
  test('matches by peer id from an artifact path', () => {
    expect(resolveFriendName(peers, 'p2')).toBe('Sam')
  })

  test('falls back to a lone active peer when no id is given', () => {
    expect(resolveFriendName([peers[0]], null)).toBe('Alex')
  })

  test('does not guess when several friends exist', () => {
    expect(resolveFriendName(peers, null)).toBe(FRIEND_FALLBACK_NAME)
  })

  test('does not pick a different friend when the id is unknown', () => {
    expect(resolveFriendName([peers[0]], 'missing')).toBe(FRIEND_FALLBACK_NAME)
  })

  test('ignores blank names', () => {
    expect(resolveFriendName([{ id: 'p1', name: '   ' }], 'p1')).toBe(FRIEND_FALLBACK_NAME)
  })

  test('resolvePeer ignores revoked peers for id-less guesses', () => {
    expect(resolvePeer([{ id: 'p1', name: 'Old', status: 'revoked' }], null)).toBeNull()
  })
})

describe('friend app kind and presence', () => {
  test('C1 kind wins over the legacy remote URL inference', () => {
    expect(friendAppKind({ kind: 'lazybro', remoteBaseUrl: 'https://x' })).toBe('lazybro')
  })

  test('empty remote URL means LazyBro', () => {
    expect(friendAppKind({ remoteBaseUrl: '' })).toBe('lazybro')
    expect(friendAppKind({ remoteBaseUrl: 'https://x' })).toBe('lazybackup')
    expect(friendAppLabel('lazybackup')).toBe('LazyBackup')
    expect(friendAppLabel('lazybro')).toBe('LazyBro')
  })

  test('C1 online flag is authoritative', () => {
    expect(friendIsOnline({ online: false, lastSeenAt: new Date().toISOString() })).toBe(false)
    expect(friendIsOnline({ online: true, lastSeenAt: null })).toBe(true)
  })

  test('falls back to a 90 second last-seen window', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(friendIsOnline({ lastSeenAt: new Date(now - 30_000).toISOString() }, now)).toBe(true)
    expect(friendIsOnline({ lastSeenAt: new Date(now - 120_000).toISOString() }, now)).toBe(false)
    expect(friendIsOnline({ lastSeenAt: null }, now)).toBeNull()
  })

  test('possessive handles names ending in s', () => {
    expect(friendPossessive('Alex')).toBe("Alex's")
    expect(friendPossessive('Chris')).toBe("Chris'")
    expect(friendPossessive('  ')).toBe("your friend's")
  })
})

describe('restore stages and waiting copy', () => {
  test('stage labels use the friend app name', () => {
    const stages = restoreStages('Alex', 'lazybro')
    expect(stages.map((stage) => stage.id)).toEqual(['asking', 'downloading', 'restoring'])
    expect(stages[0]!.label).toBe("Asking Alex's LazyBro for the backup")
    expect(restoreStages('Sam', 'lazybackup')[0]!.label).toBe(
      "Asking Sam's LazyBackup for the backup"
    )
  })

  test('LazyBro waiting copy mentions the 45 s check-in', () => {
    const copy = restoreWaitingCopy({
      friendName: 'Alex',
      kind: 'lazybro',
      online: true,
      elapsedMs: 5_000,
    })
    expect(copy.headline).toBe("Asking Alex's LazyBro…")
    expect(copy.detail).toContain('45 seconds')
    expect(copy.closeHint).toBeNull()
  })

  test('full LazyBackup waiting copy is different', () => {
    const copy = restoreWaitingCopy({
      friendName: 'Alex',
      kind: 'lazybackup',
      online: true,
      elapsedMs: 0,
    })
    expect(copy.headline).toBe("Waiting for Alex's LazyBackup to send it back")
    expect(copy.detail).toContain('next sync')
  })

  test('offline copy explains the request is queued', () => {
    const copy = restoreWaitingCopy({
      friendName: 'Alex',
      kind: 'lazybro',
      online: false,
      elapsedMs: 0,
    })
    expect(copy.headline).toBe("Waiting for Alex's LazyBro to check in")
    expect(copy.detail).toContain('Keep LazyBro open')
  })

  test('close hint appears after 90 seconds of waiting', () => {
    const copy = restoreWaitingCopy({
      friendName: 'Alex',
      kind: 'lazybro',
      online: true,
      elapsedMs: RECALL_CLOSE_HINT_AFTER_MS,
    })
    expect(copy.closeHint).toContain('request stays queued')
  })

  test('preflight warns when offline and when delivery is pending', () => {
    expect(
      restorePreflightCopy({ friendName: 'Alex', kind: 'lazybro', online: false })
    ).toMatchObject({ tone: 'warning', primaryLabel: 'Request backup' })
    expect(
      restorePreflightCopy({
        friendName: 'Alex',
        kind: 'lazybackup',
        online: true,
        waitingForDelivery: true,
      })
    ).toMatchObject({ tone: 'info' })
    expect(
      restorePreflightCopy({ friendName: 'Alex', kind: 'lazybro', online: true })
    ).toBeNull()
  })

  test('polling stops at the max instead of forever', () => {
    expect(shouldStopRecallPolling(RECALL_MAX_POLL_MS - 1)).toBe(false)
    expect(shouldStopRecallPolling(RECALL_MAX_POLL_MS)).toBe(true)
  })

  test('elapsed time formats as mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
