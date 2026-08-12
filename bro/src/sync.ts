import fs from 'fs/promises';
import path from 'path';
import type { BroConfig } from './config';
import { objectFilePath, upsertObject, usedBytes } from './db';
import { createHash } from 'crypto';

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

function hostApi(cfg: BroConfig, apiPath: string): string {
  if (!cfg.hostBaseUrl) throw new Error('Not paired');
  const base = cfg.hostBaseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function hostFetch(
  cfg: BroConfig,
  apiPath: string,
  init?: RequestInit
): Promise<Response> {
  if (!cfg.outboundToken) throw new Error('Not paired');
  return fetch(hostApi(cfg, apiPath), {
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
    };

    status.pendingPulls = work.pulls?.length || 0;
    status.pendingRecalls = work.recalls?.length || 0;

    for (const pull of work.pulls || []) {
      const getRes = await hostFetch(
        cfg,
        `/api/peers/agent/pending?key=${encodeURIComponent(pull.key)}`
      );
      if (!getRes.ok) continue;
      const buf = Buffer.from(await getRes.arrayBuffer());
      await assertQuota(cfg, buf.byteLength);
      const dest = objectFilePath(cfg, pull.key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      upsertObject(cfg, pull.key, buf.byteLength, new Date().toISOString());
      const sha256 = createHash('sha256').update(buf).digest('hex');
      await hostFetch(cfg, '/api/peers/agent/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: pull.key,
          size: buf.byteLength,
          sha256,
        }),
      });
    }

    for (const recall of work.recalls || []) {
      try {
        const src = objectFilePath(cfg, recall.objectKey);
        const data = await fs.readFile(src);
        await hostFetch(cfg, `/api/peers/agent/recall/${recall.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(data.byteLength),
          },
          body: data,
        });
      } catch (err) {
        console.warn(
          `[lazybro] recall ${recall.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    status.lastSyncAt = new Date().toISOString();
    status.pendingPulls = 0;
    status.pendingRecalls = 0;
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
