import fs from 'fs/promises';
import type { BroConfig } from './config';
import { objectFilePath, unlinkObject, upsertObject, usedBytes } from './db';
import { BRO_OBJECT_HARD_CAP_BYTES, streamResponseToFile } from './stream';
import { safeRemoteFetch, type RemoteRequestInit } from './remote';

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

async function assertQuota(cfg: BroConfig, additional: number): Promise<void> {
  const used = usedBytes(cfg);
  if (cfg.quotaBytes > 0 && used + additional > cfg.quotaBytes) {
    throw new Error(
      `Quota exceeded: need ${additional} bytes, used ${used} of ${cfg.quotaBytes}`
    );
  }
}

/**
 * One sync pass: ping, pull staged objects, fulfill recalls.
 */
export async function syncOnce(cfg: BroConfig): Promise<SyncStatus> {
  if (!cfg.hostBaseUrl || !cfg.outboundToken) {
    status.hostReachable = false;
    status.lastError = null;
    return getSyncStatus(cfg);
  }

  try {
    const ping = await hostFetch(cfg, '/api/peers/agent/ping');
    if (!ping.ok) {
      status.hostReachable = false;
      status.lastError = `Ping failed (${ping.status})`;
      return getSyncStatus(cfg);
    }
    status.hostReachable = true;
    status.lastPingAt = new Date().toISOString();
    status.lastError = null;

    const workRes = await hostFetch(cfg, '/api/peers/agent/work');
    if (!workRes.ok) {
      status.lastError = `Work failed (${workRes.status})`;
      return getSyncStatus(cfg);
    }

    const work = (await workRes.json()) as {
      pulls: Array<{ key: string; size: number }>;
      recalls: Array<{ id: string; objectKey: string }>;
      deletes?: Array<{ key: string }>;
    };

    status.pendingPulls = work.pulls?.length || 0;
    status.pendingRecalls = work.recalls?.length || 0;

    for (const pull of work.pulls || []) {
      const getRes = await hostFetch(
        cfg,
        `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
      );
      if (!getRes.ok) continue;
      await assertQuota(cfg, pull.size);
      const dest = objectFilePath(cfg, pull.key);
      const downloaded = await streamResponseToFile({
        response: getRes,
        destPath: dest,
        maxBytes: Math.min(BRO_OBJECT_HARD_CAP_BYTES, cfg.quotaBytes),
        expectedBytes: pull.size,
      });
      upsertObject(cfg, pull.key, downloaded.size, new Date().toISOString());
      await hostFetch(cfg, '/api/peers/agent/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: pull.key,
          size: downloaded.size,
          sha256: downloaded.sha256,
        }),
      });
    }

    let remainingRecalls = work.recalls?.length || 0;
    for (const recall of work.recalls || []) {
      try {
        const src = objectFilePath(cfg, recall.objectKey);
        const stat = await fs.stat(src);
        if (stat.size > BRO_OBJECT_HARD_CAP_BYTES) {
          throw new Error(`Recall exceeds maximum of ${BRO_OBJECT_HARD_CAP_BYTES} bytes`);
        }
        await hostFetch(cfg, `/api/peers/agent/recall/${recall.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(stat.size),
          },
          body: Bun.file(src),
        });
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
        await hostFetch(cfg, '/api/peers/agent/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: del.key,
            exists: false,
            size: 0,
          }),
        });
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
  } catch (err) {
    status.hostReachable = false;
    status.lastError = err instanceof Error ? err.message : String(err);
  }

  return getSyncStatus(cfg);
}

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
