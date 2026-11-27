import { describe, expect, test } from 'bun:test'
import {
  backupFinishedToast,
  deliveryBadgeCopy,
  deliveryErrorFor,
  deriveDeliveryState,
  historyDisplayStats,
  isPeerDestination,
  peerIdForHistoryRow,
} from './delivery-state'

describe('deriveDeliveryState', () => {
  test('C4 deliveryState wins', () => {
    expect(
      deriveDeliveryState({
        status: 'success',
        deliveryState: 'stored',
        mailboxPending: true,
        artifactPath: 'peer://p1/a.tar.gz.age',
        destinationKind: 'peer',
      })
    ).toBe('stored')
  })

  test('falls back to mailboxPending when C4 is absent', () => {
    const base = {
      status: 'success',
      artifactPath: 'peer://p1/a.tar.gz.age',
      destinationKind: 'peer' as const,
    }
    expect(deriveDeliveryState({ ...base, mailboxPending: true })).toBe('waiting')
    expect(deriveDeliveryState({ ...base, mailboxPending: false })).toBe('stored')
  })

  test('peer artifact path alone is enough to detect a peer destination', () => {
    expect(
      deriveDeliveryState({
        status: 'success',
        artifactPath: 'peer://p1/a.tar.gz.age',
        mailboxPending: true,
      })
    ).toBe('waiting')
    expect(isPeerDestination({ artifactPath: 'peer://p1/a' })).toBe(true)
    expect(isPeerDestination({ artifactPath: '/backups/a' })).toBe(false)
  })

  test('non-peer destinations have no delivery state', () => {
    expect(
      deriveDeliveryState({
        status: 'success',
        artifactPath: '/backups/local/a',
        mailboxPending: true,
      })
    ).toBeNull()
  })

  test('running and failed transfers have no delivery state', () => {
    expect(
      deriveDeliveryState({
        status: 'running',
        artifactPath: 'peer://p1/a',
        destinationKind: 'peer',
        mailboxPending: true,
      })
    ).toBeNull()
    expect(
      deriveDeliveryState({
        status: 'failed',
        artifactPath: 'peer://p1/a',
        destinationKind: 'peer',
      })
    ).toBeNull()
  })

  test('unknown strings are ignored, failed is explicit', () => {
    expect(
      deriveDeliveryState({
        deliveryState: 'weird',
        status: 'success',
        artifactPath: 'peer://p1/a',
        destinationKind: 'peer',
      })
    ).toBe('stored')
    expect(
      deriveDeliveryState({
        deliveryState: 'failed',
        status: 'success',
        artifactPath: 'peer://p1/a',
        destinationKind: 'peer',
      })
    ).toBe('failed')
  })

  test('a stale stored payload cannot mark a failed or artifact-less run off-site', () => {
    expect(
      deriveDeliveryState({
        deliveryState: 'stored',
        status: 'failed',
        artifactPath: 'peer://p1/a',
        destinationKind: 'peer',
      })
    ).toBeNull()
    expect(
      deriveDeliveryState({
        deliveryState: 'stored',
        status: 'success',
        artifactPath: null,
        destinationKind: 'peer',
      })
    ).toBeNull()
    expect(
      deriveDeliveryState({
        deliveryState: 'stored',
        status: 'success',
        artifactPath: '/backups/local/a',
        destinationKind: 'local',
      })
    ).toBeNull()
  })
})

describe('delivery copy', () => {
  test('badge copy for waiting, stored and failed', () => {
    expect(
      deliveryBadgeCopy({ state: 'waiting', friendName: 'Alex' })
    ).toMatchObject({
      label: 'Waiting for Alex',
      title: "Saved on this server. Not yet on Alex's disk.",
      tone: 'warning',
    })
    expect(deliveryBadgeCopy({ state: 'stored', friendName: 'Alex' })).toMatchObject({
      label: "Stored on Alex's disk",
      tone: 'success',
    })
    expect(
      deliveryBadgeCopy({ state: 'failed', friendName: 'Alex', error: 'Folder is full' })
    ).toMatchObject({
      label: 'Could not deliver to Alex',
      title: 'Could not deliver to Alex: Folder is full',
      tone: 'error',
    })
    expect(deliveryBadgeCopy({ state: null, friendName: 'Alex' })).toBeNull()
  })

  test('waiting toast is info, not success', () => {
    expect(
      backupFinishedToast({ state: 'waiting', friendName: 'Alex', kind: 'lazybro' })
    ).toMatchObject({
      variant: 'info',
      title: "Saved on this server — waiting for Alex's LazyBro",
    })
    expect(
      backupFinishedToast({ state: 'waiting', friendName: 'Sam', kind: 'lazybackup' })?.title
    ).toBe("Saved on this server — waiting for Sam's LazyBackup")
    expect(
      backupFinishedToast({ state: 'stored', friendName: 'Alex' })?.variant
    ).toBe('success')
    expect(
      backupFinishedToast({
        state: 'failed',
        friendName: 'Alex',
        error: "Alex's folder is full",
      })
    ).toMatchObject({ variant: 'error', description: "Alex's folder is full" })
  })

  test('delivery error prefers C4 field', () => {
    expect(
      deliveryErrorFor({ deliveryError: 'quota', mailboxError: 'old' })
    ).toBe('quota')
    expect(deliveryErrorFor({ mailboxError: '  quota  ' })).toBe('quota')
    expect(deliveryErrorFor({})).toBeNull()
  })
})

describe('historyDisplayStats', () => {
  test('uses stored rsync stats when present', () => {
    expect(
      historyDisplayStats({ totalSize: 2048, fileCount: 12, artifactPath: '/x/y' })
    ).toEqual({ sizeBytes: 2048, filesLabel: '12', isArchive: false })
  })

  test('falls back to the Size line for a single archive', () => {
    const log = 'Archive: docs.tar.gz\nPeer: Alex\nSize: 3147560 bytes\n'
    expect(
      historyDisplayStats({
        artifactPath: 'peer://p1/docs/docs.tar.gz.age',
        logOutput: `========== Backup Transfer (rsync) ==========\n${log}`,
      })
    ).toEqual({ sizeBytes: 3147560, filesLabel: '1 archive', isArchive: true })
  })

  test('archive without a log still reports one archive', () => {
    expect(
      historyDisplayStats({ artifactPath: 'peer://p1/docs.tar.gz.age' })
    ).toEqual({ sizeBytes: null, filesLabel: '1 archive', isArchive: true })
  })

  test('plain path rows without stats stay empty (not fake zero)', () => {
    expect(historyDisplayStats({ artifactPath: '/backups/tree' })).toEqual({
      sizeBytes: null,
      filesLabel: null,
      isArchive: false,
    })
  })
})

describe('peerIdForHistoryRow', () => {
  test('prefers nested config ids then the artifact path', () => {
    expect(
      peerIdForHistoryRow({
        destinationPeerId: 'p1',
        destinationPeer: { id: 'p2' },
        artifactPath: 'peer://p3/a',
      })
    ).toBe('p1')
    expect(peerIdForHistoryRow({ artifactPath: 'peer://p3/a' })).toBe('p3')
    expect(peerIdForHistoryRow({ artifactPath: '/local' })).toBeNull()
  })
})
