import { describe, expect, test } from 'bun:test';
import {
  deliveryStateForHistoryRow,
  deriveDeliveryState,
  parsePeerArtifactPath,
} from './delivery-state';

describe('parsePeerArtifactPath', () => {
  test('splits peer id from nested object keys', () => {
    expect(parsePeerArtifactPath('peer://peer_1/backups/config/a.age')).toEqual({
      peerId: 'peer_1',
      objectKey: 'backups/config/a.age',
    });
  });

  test('rejects non-peer and malformed paths', () => {
    expect(parsePeerArtifactPath('/backups/a.age')).toBeNull();
    expect(parsePeerArtifactPath('s3://bucket/a.age')).toBeNull();
    expect(parsePeerArtifactPath('peer://peer_1/')).toBeNull();
  });
});

describe('deriveDeliveryState (C4)', () => {
  test('null for non-peer destinations', () => {
    expect(
      deriveDeliveryState({
        destinationKind: 's3',
        mailboxPending: true,
        artifactPath: 'peer://p1/a.age',
      })
    ).toBeNull();
  });

  test('stored once the ACK cleared mailboxPending', () => {
    expect(
      deriveDeliveryState({
        destinationKind: 'peer',
        mailboxPending: false,
        artifactPath: 'peer://p1/a.age',
      })
    ).toBe('stored');
  });

  test('waiting while staged and the peer reports no object-specific error', () => {
    expect(
      deriveDeliveryState({
        destinationKind: 'peer',
        mailboxPending: true,
        artifactPath: 'peer://p1/a.age',
        peer: { remoteLastError: 'Ping failed: connect timeout' },
      })
    ).toBe('waiting');
  });

  test('failed when the peer error names this object key', () => {
    expect(
      deriveDeliveryState({
        destinationKind: 'peer',
        mailboxPending: true,
        artifactPath: 'peer://p1/backups/a.age',
        peer: {
          remoteLastError: 'Pull backups/a.age: Quota exceeded: need 10 bytes',
        },
      })
    ).toBe('failed');
  });

  test('a different object error does not mark this row failed', () => {
    expect(
      deriveDeliveryState({
        destinationKind: 'peer',
        mailboxPending: true,
        artifactPath: 'peer://p1/backups/a.age',
        peer: { remoteLastError: 'Pull backups/other.age: HTTP 500' },
      })
    ).toBe('waiting');
  });

  test('history row convenience uses the nested destination peer', () => {
    expect(
      deliveryStateForHistoryRow({
        mailboxPending: true,
        artifactPath: 'peer://p1/a.age',
        backupConfig: {
          destinationKind: 'peer',
          destinationPeer: { remoteLastError: 'ACK a.age: HTTP 409' },
        },
      })
    ).toBe('failed');
  });

  test('a failed peer run is never reported as stored', () => {
    expect(
      deliveryStateForHistoryRow({
        status: 'failed',
        mailboxPending: false,
        artifactPath: null,
        backupConfig: { destinationKind: 'peer' },
      })
    ).toBeNull();
    // Even if a stale pending flag/artifact is left behind.
    expect(
      deliveryStateForHistoryRow({
        status: 'failed',
        mailboxPending: false,
        artifactPath: 'peer://p1/a.age',
        backupConfig: { destinationKind: 'peer' },
      })
    ).toBeNull();
  });

  test('a running peer run with no artifact is not stored yet', () => {
    expect(
      deliveryStateForHistoryRow({
        status: 'running',
        mailboxPending: false,
        artifactPath: null,
        backupConfig: { destinationKind: 'peer' },
      })
    ).toBeNull();
  });

  test('a success row without an artifact has no delivery state', () => {
    expect(
      deliveryStateForHistoryRow({
        status: 'success',
        mailboxPending: false,
        artifactPath: null,
        backupConfig: { destinationKind: 'peer' },
      })
    ).toBeNull();
  });

  test('the artifact path, not the edited live config, decides peer delivery', () => {
    // Local run, config later edited to a friend: never "stored on friend".
    expect(
      deliveryStateForHistoryRow({
        status: 'success',
        mailboxPending: false,
        artifactPath: '/backups/local/app.tar.gz',
        backupConfig: { destinationKind: 'peer' },
      })
    ).toBeNull();
    // Peer run, config later edited away: the delivery state still applies.
    expect(
      deliveryStateForHistoryRow({
        status: 'success',
        mailboxPending: false,
        artifactPath: 'peer://p1/app.tar.gz',
        backupConfig: { destinationKind: 'local' },
      })
    ).toBe('stored');
  });
});
