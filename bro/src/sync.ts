import fs from 'fs/promises';
import type { BroConfig } from './config';
import {
  MAX_BRO_OBJECTS,
  getObject,
  objectCount,
  objectFilePath,
  unlinkObject,
  upsertObject,
  usedBytes,
} from './db';
import { readCappedJson } from './json-limit';
import { createSingleFlight } from './single-flight';
import { BRO_OBJECT_HARD_CAP_BYTES, streamResponseToFile } from './stream';
import { safeRemoteFetch, type RemoteRequestInit } from './remote';

export const PEER_CONTROL_JSON_LIMIT = 4 * 1024 * 1024;
const CONTROL_TIMEOUT_MS = 30_000;

export type SyncStatus = {
  lastPingAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  hostReachable: boolean;
  pendingPulls: number;
  pendingRecalls: number;
  usedBytes: number;
  quotaBytes: number;
};

let status: SyncStatus = {
  lastPingAt: null,
  lastSyncAt: null,
  lastError: null,
  hostReachable: false,
  pendingPulls: 0,
  pendingRecalls: 0,
  usedBytes: 0,
  quotaBytes: 0,
};

export function getSyncStatus(cfg: BroConfig): SyncStatus {
  return {
    ...status,
    usedBytes: usedBytes(cfg),
    quotaBytes: cfg.quotaBytes,
  };
}

export function mailboxDeletesToApply(
  deletes: Array<{ key: string }> | undefined,
  recallObjectKeys: Iterable<string>
): Array<{ key: string }> {
  const blocked = new Set(recallObjectKeys);
  return (deletes || []).filter((del) => !blocked.has(del.key));
}

/**
 * A recall upload is only done when the host accepted it. Returns an error message
 * for a failed response (parseable so the caller can surface it) or null on success.
 */
export function recallUploadFailure(
  response: { ok: boolean; status: number },
  bodyText: string
): string | null {
  if (response.ok) return null;
  let detail = bodyText.trim();
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        detail = parsed.error.trim();
      }
    } catch {
      /* keep raw text */
    }
  }
  const trimmed = detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
  return `Recall upload failed (${response.status})${trimmed ? `: ${trimmed}` : ''}`;
}

export type RecallChunk = {
  index: number;
  start: number;
  end: number;
  length: number;
};

/** Keep the layout in sync with src/lib/peer/recall-chunk.ts on the host. */
export function planRecallChunks(totalBytes: number, chunkMax: number): RecallChunk[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid recall size');
  }
  if (!Number.isSafeInteger(chunkMax) || chunkMax <= 0) {
    throw new Error('Invalid recall chunk size');
  }
  const chunks: RecallChunk[] = [];
  let index = 0;
  for (let start = 0; start < totalBytes; start += chunkMax) {
    const end = Math.min(totalBytes, start + chunkMax);
    chunks.push({ index, start, end, length: end - start });
    index += 1;
  }
  return chunks;
}

/** Upload a recall in fixed-size chunks so reverse proxies never see one huge body. */
export async function uploadRecallChunks(
  cfg: BroConfig,
  recallId: string,
  srcPath: string,
  totalBytes: number,
  chunkMax: number
): Promise<void> {
  const chunks = planRecallChunks(totalBytes, chunkMax);
  if (chunks.length === 0) throw new Error('Recall artifact is empty');
  for (const chunk of chunks) {
    const res = await hostFetch(
      cfg,
      `/api/peers/agent/recall/${recallId}?chunk=${chunk.index}&chunks=${chunks.length}&total=${totalBytes}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunk.length),
        },
        body: Bun.file(srcPath).slice(chunk.start, chunk.end),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        recallUploadFailure(res, detail) ??
          `Recall chunk ${chunk.index + 1}/${chunks.length} failed (${res.status})`
      );
    }
  }
}

function hostApi(cfg: BroConfig, apiPath: string): string {
  if (!cfg.hostBaseUrl) throw new Error('Not paired');
  const base = cfg.hostBaseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function hostFetch(
  cfg: BroConfig,
  apiPath: string,
  init?: RemoteRequestInit
): Promise<Response> {
  if (!cfg.outboundToken) throw new Error('Not paired');
  return safeRemoteFetch(hostApi(cfg, apiPath), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${cfg.outboundToken}`,
    },
  });
}

async function assertQuota(
  cfg: BroConfig,
  additional: number,
  replacingKey?: string
): Promise<void> {
  const count = objectCount(cfg);
  const replacing = replacingKey ? getObject(cfg, replacingKey) : null;
  if (count - (replacing ? 1 : 0) >= MAX_BRO_OBJECTS) {
    throw new Error(
      `Object limit reached (${MAX_BRO_OBJECTS}); delete old objects before pulling more`
    );
  }
  // A re-pull (lost ACK, restart) replaces the existing object of the same key,
  // so only the net growth counts against the quota.
  const used = Math.max(0, usedBytes(cfg) - (replacing?.size ?? 0));
  if (cfg.quotaBytes > 0 && used + additional > cfg.quotaBytes) {
    throw new Error(
      `Quota exceeded: need ${additional} bytes, used ${used} of ${cfg.quotaBytes}`
    );
  }
}

/**
 * One sync pass: ping, pull staged objects, fulfill recalls.
 * Serialized via createSingleFlight at the bottom of this file so timer ticks
 * cannot overlap and double-write partial downloads.
 */
async function runSyncOnce(cfg: BroConfig): Promise<SyncStatus> {
  if (!cfg.hostBaseUrl || !cfg.outboundToken) {
    status.hostReachable = false;
    status.lastError = null;
    return getSyncStatus(cfg);
  }

  try {
    const ping = await hostFetch(cfg, '/api/peers/agent/ping', {
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
    if (!ping.ok) {
      status.hostReachable = false;
      status.lastError = `Ping failed (${ping.status})`;
      return getSyncStatus(cfg);
    }
    status.hostReachable = true;
    status.lastPingAt = new Date().toISOString();
    status.lastError = null;

    const workRes = await hostFetch(cfg, '/api/peers/agent/work', {
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
    if (!workRes.ok) {
      status.lastError = `Work failed (${workRes.status})`;
      return getSyncStatus(cfg);
    }

    const work = (await readCappedJson(workRes, PEER_CONTROL_JSON_LIMIT)) as {
      pulls: Array<{ key: string; size: number }>;
      recalls: Array<{ id: string; objectKey: string }>;
      deletes?: Array<{ key: string }>;
      recallChunkMaxBytes?: number;
    };

    // Hosts that advertise a chunk size accept large recalls in pieces; older
    // hosts only take a single body (capped by their own proxy/middleware).
    const recallChunkMax =
      Number.isSafeInteger(work.recallChunkMaxBytes) && (work.recallChunkMaxBytes ?? 0) > 0
        ? Number(work.recallChunkMaxBytes)
        : 0;

    status.pendingPulls = work.pulls?.length || 0;
    status.pendingRecalls = work.recalls?.length || 0;

    // Failures are per item: one oversized/corrupt object must not block
    // recalls (restores) or retention deletes for the rest of the pass.
    const errors: string[] = [];

    for (const pull of work.pulls || []) {
      try {
        const getRes = await hostFetch(
          cfg,
          `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
        );
        if (!getRes.ok) {
          errors.push(`Pull ${pull.key}: HTTP ${getRes.status}`);
          continue;
        }
        await assertQuota(cfg, pull.size, pull.key);
        const dest = objectFilePath(cfg, pull.key);
        const downloaded = await streamResponseToFile({
          response: getRes,
          destPath: dest,
          maxBytes: Math.min(BRO_OBJECT_HARD_CAP_BYTES, cfg.quotaBytes),
          expectedBytes: pull.size,
        });
        upsertObject(cfg, pull.key, downloaded.size, new Date().toISOString());
        const ackRes = await hostFetch(cfg, '/api/peers/agent/ack', {
          method: 'POST',
          signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: pull.key,
            size: downloaded.size,
            sha256: downloaded.sha256,
          }),
        });
        if (!ackRes.ok) {
          errors.push(`ACK ${pull.key}: HTTP ${ackRes.status}`);
        }
      } catch (err) {
        errors.push(
          `Pull ${pull.key}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    let remainingRecalls = work.recalls?.length || 0;
    for (const recall of work.recalls || []) {
      try {
        const src = objectFilePath(cfg, recall.objectKey);
        const stat = await fs.stat(src);
        if (stat.size > BRO_OBJECT_HARD_CAP_BYTES) {
          throw new Error(`Recall exceeds maximum of ${BRO_OBJECT_HARD_CAP_BYTES} bytes`);
        }
        if (recallChunkMax > 0 && stat.size > recallChunkMax) {
          await uploadRecallChunks(cfg, recall.id, src, stat.size, recallChunkMax);
        } else {
          const putRes = await hostFetch(cfg, `/api/peers/agent/recall/${recall.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': String(stat.size),
            },
            body: Bun.file(src),
          });
          if (!putRes.ok) {
            const detail = await putRes.text().catch(() => '');
            throw new Error(
              recallUploadFailure(putRes, detail) ??
                `Recall upload failed (${putRes.status})`
            );
          }
        }
        remainingRecalls -= 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Recall ${recall.id}: ${message}`);
        console.warn(`[lazybro] recall ${recall.id}:`, message);
      }
    }

    const recallKeys = new Set((work.recalls || []).map((r) => r.objectKey));
    for (const del of mailboxDeletesToApply(work.deletes, recallKeys)) {
      try {
        await unlinkObject(cfg, del.key);
        const delRes = await hostFetch(cfg, '/api/peers/agent/ack', {
          method: 'POST',
          signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: del.key,
            exists: false,
            size: 0,
          }),
        });
        if (!delRes.ok) {
          errors.push(`Delete ACK ${del.key}: HTTP ${delRes.status}`);
        }
      } catch (err) {
        console.warn(
          `[lazybro] delete ${del.key}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    status.lastSyncAt = new Date().toISOString();
    status.pendingPulls = 0;
    status.pendingRecalls = remainingRecalls;
    // Keep hostReachable true: the host answered, individual items failed.
    status.lastError = errors.length ? errors.join('; ') : null;
  } catch (err) {
    status.hostReachable = false;
    status.lastError = err instanceof Error ? err.message : String(err);
  }

  return getSyncStatus(cfg);
}

/** Serialized sync pass (one at a time; overlapping ticks reuse the run). */
export const syncOnce = createSingleFlight(runSyncOnce);

export function startSyncLoop(cfg: BroConfig, getCfg: () => BroConfig): void {
  const tick = async () => {
    const c = getCfg();
    await syncOnce(c);
    // Optional folder backup
    try {
      const { maybeRunFolderBackup } = await import('./backup/push');
      await maybeRunFolderBackup(c, getCfg);
    } catch (err) {
      console.warn('[lazybro] folder backup:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => void tick(), Math.max(10_000, cfg.pollIntervalMs));
}
