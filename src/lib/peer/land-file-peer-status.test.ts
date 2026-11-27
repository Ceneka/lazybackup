import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { landLocalFileArtifact } from '@/lib/backup/land-file';
import { stagedObjectExists } from './staging';

function peerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'peer_mailbox',
    name: 'Bro',
    remoteBaseUrl: '',
    remotePeerId: 'remote_peer',
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    inboundTokenHash: 'hash',
    inboundTokenPrefix: 'lbpeer_aaa…',
    quotaBytes: 1024,
    usedBytes: 0,
    transport: 'mailbox' as const,
    status: 'active' as const,
    lastSeenAt: null,
    lastActivityAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('mailbox staging only for an active peer', () => {
  let tmp: string;
  let prev: string | undefined;
  let src: string;

  beforeEach(async () => {
    prev = process.env.BACKUP_STORAGE_PATH;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-land-peer-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
    src = path.join(tmp, 'archive.age');
    await fs.writeFile(src, Buffer.from('ciphertext'));
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('stages for an active mailbox peer', async () => {
    const landed = await landLocalFileArtifact({
      localFilePath: src,
      archiveName: 'artifact.age',
      destinationKind: 'peer',
      destinationPeer: peerRow() as never,
      peerPrefix: 'backups/config',
    });
    expect(landed.mailboxPending).toBe(true);
    expect(landed.artifactPath).toBe('peer://peer_mailbox/backups/config/artifact.age');
    expect(await stagedObjectExists('peer_mailbox', 'backups/config/artifact.age')).toBe(true);
  });

  test('refuses to stage when the new artifact exceeds the peer quota', async () => {
    const { writeStagedObject } = await import('./staging');
    const existing = path.join(tmp, 'existing.age');
    await fs.writeFile(existing, Buffer.alloc(8, 1));
    await writeStagedObject('peer_mailbox', 'backups/config/existing.age', existing);

    await expect(
      landLocalFileArtifact({
        localFilePath: src,
        archiveName: 'artifact.age',
        destinationKind: 'peer',
        destinationPeer: peerRow({ quotaBytes: 10 }) as never,
        peerPrefix: 'backups/config',
      })
    ).rejects.toThrow(/quota exceeded/i);
    expect(await stagedObjectExists('peer_mailbox', 'backups/config/artifact.age')).toBe(false);
  });

  test('refuses to stage for a revoked peer', async () => {
    await expect(
      landLocalFileArtifact({
        localFilePath: src,
        archiveName: 'artifact.age',
        destinationKind: 'peer',
        destinationPeer: peerRow({ status: 'revoked' }) as never,
        peerPrefix: 'backups/config',
      })
    ).rejects.toThrow(/revoked|not active|re-pair/i);
    // A revoked pair must not leave a blob that can never be pulled.
    expect(await stagedObjectExists('peer_mailbox', 'backups/config/artifact.age')).toBe(false);
  });
});
