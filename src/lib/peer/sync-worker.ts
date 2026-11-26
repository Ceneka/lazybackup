import { and, eq, ne } from 'drizzle-orm';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';
import {
  PEER_CONTROL_JSON_LIMIT,
  readCappedResponseJson,
} from '@/lib/net/capped-json';
import { pinnedFetch, type PinnedRequestInit } from '@/lib/net/pinned-fetch';
import { peerUrlPolicy } from '@/lib/net/url-guard';
import { ingestPeerObjectUpload } from './storage';
import { planRecallChunks } from './recall-chunk';
import {
  assertDeclaredUploadSize,
  PEER_UPLOAD_HARD_CAP_BYTES,
} from './upload-limit';
import type { PeerRow } from './types';

const DEFAULT_INTERVAL_MS = 45_000;
/** Control-plane (ping/work/ack) calls must not hang a sync worker. */
const CONTROL_TIMEOUT_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
/** Peer IDs with a sync pass already running. */
const inFlight = new Set<string>();

function peerApi(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function peerFetch(
  peer: PeerRow,
  apiPath: string,
  init?: PinnedRequestInit
): Promise<Response> {
  if (!peer.outboundToken || !peer.remoteBaseUrl) {
    throw new Error('Peer missing outbound credentials');
  }
  return pinnedFetch(peerApi(peer.remoteBaseUrl, apiPath), peerUrlPolicy(), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${peer.outboundToken}`,
    },
  });
}

/**
 * Pull mailbox work from a remote LB peer (LB↔LB).
 * Skips LazyBro clients (empty remoteBaseUrl).
 */
export async function syncPeerOnce(peer: PeerRow): Promise<void> {
  if (!peer.remoteBaseUrl?.trim() || !peer.outboundToken) return;
  if (peer.status !== 'active') return;
  if (peer.transport === 'direct') return;

  // Cheap presence
  await peerFetch(peer, '/api/peers/agent/ping', {
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  }).catch(() => null);

  const workRes = await peerFetch(peer, '/api/peers/agent/work', {
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
  if (!workRes.ok) {
    console.warn(`[peer-sync] work failed for ${peer.name}: ${workRes.status}`);
    return;
  }

  const work = (await readCappedResponseJson(
    workRes,
    PEER_CONTROL_JSON_LIMIT
  )) as {
    pulls: Array<{ key: string; size: number }>;
    recalls: Array<{ id: string; objectKey: string }>;
    deletes?: Array<{ key: string }>;
    recallChunkMaxBytes?: number;
  };

  const recallChunkMax =
    Number.isSafeInteger(work.recallChunkMaxBytes) && (work.recallChunkMaxBytes ?? 0) > 0
      ? Number(work.recallChunkMaxBytes)
      : 0;

  for (const pull of work.pulls || []) {
    // A single bad/oversized staged object must not abort recalls (restores)
    // or retention deletes for the rest of this peer's mailbox.
    try {
      const getRes = await peerFetch(
        peer,
        `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
      );
      if (!getRes.ok) {
        console.warn(`[peer-sync] pending get failed ${pull.key}: ${getRes.status}`);
        continue;
      }
      const declaredBytes = assertDeclaredUploadSize({
        contentLengthHeader: getRes.headers.get('content-length'),
        quotaBytes: peer.quotaBytes,
      });
      if (declaredBytes !== pull.size) {
        throw new Error(
          `Pending object size mismatch for ${pull.key}: expected ${pull.size}, got ${declaredBytes}`
        );
      }
      const stored = await ingestPeerObjectUpload({
        peerId: peer.id,
        objectKey: pull.key,
        quotaBytes: peer.quotaBytes,
        declaredBytes,
        body: getRes.body,
      });
      const ackRes = await peerFetch(peer, '/api/peers/agent/ack', {
        method: 'POST',
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: pull.key,
          size: stored.size,
          sha256: stored.sha256,
        }),
      });
      if (!ackRes.ok) {
        console.warn(`[peer-sync] ack failed ${pull.key}: ${ackRes.status}`);
      }
    } catch (err) {
      console.warn(
        `[peer-sync] pull ${pull.key} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  for (const recall of work.recalls || []) {
    try {
      const { peerObjectPath } = await import('./storage');
      const localPath = peerObjectPath(peer.id, recall.objectKey);
      const stat = await fs.stat(localPath);
      if (stat.size > PEER_UPLOAD_HARD_CAP_BYTES) {
        throw new Error(`Recall exceeds maximum of ${PEER_UPLOAD_HARD_CAP_BYTES} bytes`);
      }

      if (recallChunkMax > 0 && stat.size > recallChunkMax) {
        const chunks = planRecallChunks(stat.size, recallChunkMax);
        if (chunks.length === 0) throw new Error('Recall artifact is empty');
        for (const chunk of chunks) {
          const putRes = await peerFetch(
            peer,
            `/api/peers/agent/recall/${recall.id}?chunk=${chunk.index}&chunks=${chunks.length}&total=${stat.size}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(chunk.length),
              },
              body: createReadStream(localPath, {
                start: chunk.start,
                end: chunk.end - 1,
              }),
            }
          );
          if (!putRes.ok) {
            throw new Error(
              `chunk ${chunk.index + 1}/${chunks.length} failed (${putRes.status})`
            );
          }
        }
      } else {
        const putRes = await peerFetch(peer, `/api/peers/agent/recall/${recall.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(stat.size),
          },
          body: createReadStream(localPath),
        });
        if (!putRes.ok) {
          throw new Error(`upload failed (${putRes.status})`);
        }
      }
    } catch (err) {
      console.warn(
        `[peer-sync] recall ${recall.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const recallKeys = new Set((work.recalls || []).map((r) => r.objectKey));
  for (const del of work.deletes || []) {
    if (recallKeys.has(del.key)) continue;
    try {
      const { deletePeerObjectFile } = await import('./storage');
      await deletePeerObjectFile(peer.id, del.key);
      const ackRes = await peerFetch(peer, '/api/peers/agent/ack', {
        method: 'POST',
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: del.key,
          exists: false,
          size: 0,
        }),
      });
      if (!ackRes.ok) {
        console.warn(`[peer-sync] delete ack failed ${del.key}: ${ackRes.status}`);
      }
    } catch (err) {
      console.warn(
        `[peer-sync] delete ${del.key}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export async function runPeerSyncPass(): Promise<void> {
  const rows = await db.query.peers.findMany({
    where: and(eq(peers.status, 'active'), ne(peers.remoteBaseUrl, '')),
  });

  // Each peer runs independently: a malicious or stalled peer must not stop
  // mailbox sync for everyone else (previously one hung HTTP call kept the
  // global `running` flag set forever).
  await Promise.allSettled(
    rows.map(async (peer) => {
      if (!peer.remoteBaseUrl?.trim()) return;
      if (inFlight.has(peer.id)) return;
      inFlight.add(peer.id);
      try {
        await syncPeerOnce(peer);
      } catch (err) {
        console.warn(
          `[peer-sync] ${peer.name}:`,
          err instanceof Error ? err.message : err
        );
      } finally {
        inFlight.delete(peer.id);
      }
    })
  );
}

export function startPeerSyncWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  console.log(`Starting Bro Space mailbox sync worker (${intervalMs}ms)`);
  void runPeerSyncPass();
  timer = setInterval(() => {
    void runPeerSyncPass();
  }, intervalMs);
  // Avoid keeping process alive solely for this in tests
  if (typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}
