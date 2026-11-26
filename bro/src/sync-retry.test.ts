import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';
import * as realRemote from './remote';

type Call = { url: string; init?: { method?: string } };

let calls: Call[] = [];
let work: {
  pulls?: Array<{ key: string; size: number }>;
  recalls?: Array<{ id: string; objectKey: string }>;
  deletes?: Array<{ key: string }>;
} = {};
let ackStatus = 200;
let pendingDelayMs = 0;

mock.module('./remote', () => ({
  safeRemoteFetch: async (url: string, init?: { method?: string }) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === '/api/peers/agent/ping') {
      return Response.json({ ok: true });
    }
    if (parsed.pathname === '/api/peers/agent/work') {
      return Response.json({
        pulls: work.pulls || [],
        recalls: work.recalls || [],
        deletes: work.deletes || [],
      });
    }
    if (parsed.pathname === '/api/peers/agent/pending') {
      const key = parsed.searchParams.get('key') || '';
      const entry = (work.pulls || []).find((p) => p.key === key);
      const size = entry?.size ?? 0;
      if (pendingDelayMs) await new Promise((r) => setTimeout(r, pendingDelayMs));
      return new Response(Buffer.alloc(size, 9), {
        headers: { 'Content-Length': String(size) },
      });
    }
    if (parsed.pathname === '/api/peers/agent/ack') {
      return Response.json(
        ackStatus === 200 ? { ok: true } : { error: 'ack rejected' },
        { status: ackStatus }
      );
    }
    if (parsed.pathname.startsWith('/api/peers/agent/recall/')) {
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
}));

const { syncOnce } = await import('./sync');
const { closeDb, getObject, usedBytes, upsertObject } = await import('./db');

afterAll(() => {
  // Bun module mocks are process-wide; put the real module back for other files.
  mock.module('./remote', () => realRemote);
});

function testCfg(dir: string, quotaBytes: number): BroConfig {
  return {
    dataDir: dir,
    shareDir: path.join(dir, 'share'),
    port: 3789,
    label: 'test',
    pollIntervalMs: 45_000,
    hostBaseUrl: 'http://host.test:3000',
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    localPeerId: 'local',
    remotePeerId: 'remote',
    remoteLabel: 'host',
    quotaBytes,
    folderBackupPath: null,
    folderBackupIntervalMs: 0,
    lastFolderBackupAt: null,
    ageIdentity: null,
    ageRecipient: null,
    autostartPrompted: false,
    openUiOnStart: false,
    localApiToken: 'test-local-api-token',
  };
}

describe('LazyBro syncOnce', () => {
  let tmp: string;
  let cfg: BroConfig;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-sync-'));
    cfg = testCfg(tmp, 10);
    await fs.mkdir(path.join(cfg.shareDir, 'objects'), { recursive: true });
    calls = [];
    work = { pulls: [], recalls: [], deletes: [] };
    ackStatus = 200;
    pendingDelayMs = 0;
    closeDb();
  });

  afterEach(async () => {
    closeDb();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('re-pulls an already-stored object after a lost ack (no double quota)', async () => {
    // First pass: pull succeeds, ack is lost.
    work = { pulls: [{ key: 'a.age', size: 8 }], recalls: [], deletes: [] };
    ackStatus = 500;
    await syncOnce(cfg);
    expect(getObject(cfg, 'a.age')?.size).toBe(8);
    expect(usedBytes(cfg)).toBe(8);

    // Host never saw the ack, so it advertises the same object again.
    // It fits in the remaining quota because it replaces the local copy.
    ackStatus = 200;
    const status = await syncOnce(cfg);
    expect(status.hostReachable).toBe(true);
    expect(status.lastError).toBeNull();
    expect(usedBytes(cfg)).toBe(8);
  });

  test('an object over quota does not block recalls or deletes', async () => {
    cfg.quotaBytes = 4;
    work = {
      pulls: [{ key: 'too-big.age', size: 8 }],
      recalls: [{ id: 'r1', objectKey: 'restore.age' }],
      deletes: [{ key: 'old.age' }],
    };
    const restorePath = path.join(cfg.shareDir, 'objects', 'restore.age');
    await fs.mkdir(path.dirname(restorePath), { recursive: true });
    await fs.writeFile(restorePath, Buffer.alloc(4, 1));
    upsertObject(cfg, 'restore.age', 4, new Date().toISOString());

    const status = await syncOnce(cfg);

    const recallPut = calls.find(
      (c) => c.init?.method === 'PUT' && c.url.includes('/api/peers/agent/recall/r1')
    );
    expect(recallPut).toBeDefined();
    expect(status.hostReachable).toBe(true);
    expect(status.lastError).toMatch(/quota/i);
  });

  test('a rejected ack is surfaced instead of silently succeeding', async () => {
    work = { pulls: [{ key: 'a.age', size: 8 }], recalls: [], deletes: [] };
    ackStatus = 409;

    const status = await syncOnce(cfg);

    expect(status.lastError).toMatch(/ack/i);
    expect(status.lastError).toMatch(/409/);
  });
});
