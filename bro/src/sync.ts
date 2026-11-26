import fs from 'fs/promises';
import pkg from '../package.json';
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
  /** The host said 401/403: the friend removed this connection. */
  authRevoked: boolean;
  /** Per-item failures (quota, bad ACK) need a human look, not a reconnect. */
  needsAttention: boolean;
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
  authRevoked: false,
  needsAttention: false,
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

export type ControlFailure = {
  hostReachable: boolean;
  authRevoked: boolean;
  needsAttention: boolean;
  lastError: string;
};

const AUTH_REVOKED_MESSAGE =
  'Your friend removed this connection. Ask them for a new invite.';

/**
 * Classify a non-OK ping/work response.
 * - 401/403 = the friend revoked the pair, not a network problem.
 * - 5xx = host unreachable/broken (retry with backoff).
 * - other 4xx = reachable but this client needs attention.
 */
export function classifyControlResponse(
  operation: 'ping' | 'work' | 'report',
  statusCode: number
): ControlFailure {
  const label =
    operation === 'ping' ? 'Ping' : operation === 'work' ? 'Work' : 'Status report';
  if (statusCode === 401 || statusCode === 403) {
    return {
      hostReachable: true,
      authRevoked: true,
      needsAttention: false,
      lastError: AUTH_REVOKED_MESSAGE,
    };
  }
  if (statusCode >= 500) {
    return {
      hostReachable: false,
      authRevoked: false,
      needsAttention: false,
      lastError: `${label} failed (${statusCode})`,
    };
  }
  return {
    hostReachable: true,
    authRevoked: false,
    needsAttention: true,
    lastError: `${label} failed (${statusCode})`,
  };
}

export function classifyTransportFailure(
  operation: 'ping' | 'work' | 'report',
  error: unknown
): ControlFailure {
  const label =
    operation === 'ping' ? 'Ping' : operation === 'work' ? 'Work' : 'Status report';
  const message = error instanceof Error ? error.message : String(error);
  return {
    hostReachable: false,
    authRevoked: false,
    needsAttention: false,
    lastError: `${label} failed: ${message}`,
  };
}

/** Per-item failures (quota, corrupt pull, bad ACK) are not connectivity issues. */
export function summarizeItemErrors(errors: string[]): {
  needsAttention: boolean;
  lastError: string | null;
} {
  if (errors.length === 0) return { needsAttention: false, lastError: null };
  const text = errors.join('; ');
  return {
    needsAttention: true,
    lastError: text.length > 500 ? `${text.slice(0, 500)}…` : text,
  };
}

function applyFailure(next: ControlFailure): void {
  status.hostReachable = next.hostReachable;
  status.authRevoked = next.authRevoked;
  status.needsAttention = next.needsAttention;
  status.lastError = next.lastError;
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
async function sendStatusReport(cfg: BroConfig): Promise<void> {
  try {
    const res = await hostFetch(cfg, '/api/peers/agent/ping', {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usedBytes: usedBytes(cfg),
        quotaBytes: cfg.quotaBytes,
        pendingPulls: status.pendingPulls,
        pendingRecalls: status.pendingRecalls,
        lastSyncAt: status.lastSyncAt,
        lastError: status.lastError,
        appVersion: pkg.version,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      applyFailure(classifyControlResponse('report', res.status));
    } else if (!res.ok && res.status !== 404 && res.status !== 405) {
      // Older hosts have no POST report; anything else is worth a log line
      // but must not turn a successful sync into "host unreachable".
      console.warn(`[lazybro] status report failed (${res.status})`);
    }
  } catch (err) {
    console.warn(
      '[lazybro] status report:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function runSyncOnce(cfg: BroConfig): Promise<SyncStatus> {
  if (!cfg.hostBaseUrl || !cfg.outboundToken) {
    status.hostReachable = false;
    status.authRevoked = false;
    status.needsAttention = false;
    status.lastError = null;
    return getSyncStatus(cfg);
  }

  status.authRevoked = false;
  status.needsAttention = false;

  try {
    const ping = await hostFetch(cfg, '/api/peers/agent/ping', {
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    }).catch((err) => {
      applyFailure(classifyTransportFailure('ping', err));
      return null;
    });
    if (!ping) return getSyncStatus(cfg);
    if (!ping.ok) {
      applyFailure(classifyControlResponse('ping', ping.status));
      return getSyncStatus(cfg);
    }
    status.hostReachable = true;
    status.lastPingAt = new Date().toISOString();
    status.lastError = null;

    const workRes = await hostFetch(cfg, '/api/peers/agent/work', {
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    }).catch((err) => {
      applyFailure(classifyTransportFailure('work', err));
      return null;
    });
    if (!workRes) return getSyncStatus(cfg);
    if (!workRes.ok) {
      applyFailure(classifyControlResponse('work', workRes.status));
      await sendStatusReport(cfg);
      return getSyncStatus(cfg);
    }

    const work = (await readCappedJson(workRes, PEER_CONTROL_JSON_LIMIT)) as {
      pulls: Array<{ key: string; size: number }>;
      recalls: Array<{ id: string; objectKey: string }>;
      deletes?: Array<{ key: string }>;
    };

    status.pendingPulls = work.pulls?.length || 0;
    status.pendingRecalls = work.recalls?.length || 0;

    // Failures are per item: one oversized/corrupt object must not block
    // recalls (restores) or retention deletes for the rest of the pass.
    const errors: string[] = [];
    let pullFailures = 0;

    for (const pull of work.pulls || []) {
      try {
        const getRes = await hostFetch(
          cfg,
          `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
        );
        if (!getRes.ok) {
          if (getRes.status === 401 || getRes.status === 403) {
            status.authRevoked = true;
          }
          pullFailures += 1;
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
          if (ackRes.status === 401 || ackRes.status === 403) {
            status.authRevoked = true;
          }
          pullFailures += 1;
          errors.push(`ACK ${pull.key}: HTTP ${ackRes.status}`);
        }
      } catch (err) {
        pullFailures += 1;
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
        const putRes = await hostFetch(cfg, `/api/peers/agent/recall/${recall.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(stat.size),
          },
          body: Bun.file(src),
        });
        if (!putRes.ok) {
          errors.push(`Recall ${recall.id}: HTTP ${putRes.status}`);
          continue;
        }
        remainingRecalls -= 1;
      } catch (err) {
        console.warn(
          `[lazybro] recall ${recall.id}:`,
          err instanceof Error ? err.message : err
        );
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
    status.pendingPulls = pullFailures;
    status.pendingRecalls = remainingRecalls;
    // Keep hostReachable true: the host answered, individual items failed.
    const itemSummary = summarizeItemErrors(errors);
    status.needsAttention = itemSummary.needsAttention;
    status.lastError = itemSummary.lastError;

    await sendStatusReport(cfg);
  } catch (err) {
    // Reached but unexpected (bad work JSON, etc.): retryable, not offline.
    status.hostReachable = true;
    status.needsAttention = true;
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
