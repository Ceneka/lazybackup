import { and, eq, ne } from 'drizzle-orm';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import { db } from '@/lib/db';
import { peers } from '@/lib/db/schema';
import { assertPeerBaseUrl } from '@/lib/net/url-guard';
import { writePeerObject } from './storage';
import type { PeerRow } from './types';

const DEFAULT_INTERVAL_MS = 45_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function peerApi(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function peerFetch(
  peer: PeerRow,
  apiPath: string,
  init?: RequestInit
): Promise<Response> {
  if (!peer.outboundToken || !peer.remoteBaseUrl) {
    throw new Error('Peer missing outbound credentials');
  }
  assertPeerBaseUrl(peer.remoteBaseUrl);
  return fetch(peerApi(peer.remoteBaseUrl, apiPath), {
    ...init,
    redirect: 'error',
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
  await peerFetch(peer, '/api/peers/agent/ping').catch(() => null);

  const workRes = await peerFetch(peer, '/api/peers/agent/work');
  if (!workRes.ok) {
    console.warn(`[peer-sync] work failed for ${peer.name}: ${workRes.status}`);
    return;
  }

  const work = (await workRes.json()) as {
    pulls: Array<{ key: string; size: number }>;
    recalls: Array<{ id: string; objectKey: string }>;
    deletes?: Array<{ key: string }>;
  };

  for (const pull of work.pulls || []) {
    const getRes = await peerFetch(
      peer,
      `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
    );
    if (!getRes.ok) {
      console.warn(`[peer-sync] pending get failed ${pull.key}: ${getRes.status}`);
      continue;
    }
    const buf = Buffer.from(await getRes.arrayBuffer());
    await writePeerObject(peer.id, pull.key, buf, peer.quotaBytes);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const ackRes = await peerFetch(peer, '/api/peers/agent/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: pull.key,
        size: buf.byteLength,
        sha256,
      }),
    });
    if (!ackRes.ok) {
      console.warn(`[peer-sync] ack failed ${pull.key}: ${ackRes.status}`);
    }
  }

  for (const recall of work.recalls || []) {
    try {
      const { peerObjectPath } = await import('./storage');
      const localPath = peerObjectPath(peer.id, recall.objectKey);
      const data = await fs.readFile(localPath);
      const putRes = await peerFetch(peer, `/api/peers/agent/recall/${recall.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(data.byteLength),
        },
        body: data,
      });
      if (!putRes.ok) {
        console.warn(`[peer-sync] recall upload failed ${recall.id}: ${putRes.status}`);
      }
    } catch (err) {
      console.warn(
        `[peer-sync] recall ${recall.id} missing locally:`,
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
  if (running) return;
  running = true;
  try {
    const rows = await db.query.peers.findMany({
      where: and(eq(peers.status, 'active'), ne(peers.remoteBaseUrl, '')),
    });
    for (const peer of rows) {
      if (!peer.remoteBaseUrl?.trim()) continue;
      try {
        await syncPeerOnce(peer);
      } catch (err) {
        console.warn(
          `[peer-sync] ${peer.name}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    running = false;
  }
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
