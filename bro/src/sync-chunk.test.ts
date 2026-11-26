import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import { networkInterfaces } from 'os';
import path from 'path';
import type { BroConfig } from './config';
import { recallUploadFailure, planRecallChunks, uploadRecallChunks } from './sync';

const tmp = await fs.mkdtemp('/tmp/lb-bro-chunk-');

function lanIpv4(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

const LAN_IP = lanIpv4();

function configFor(baseUrl: string): BroConfig {
  return {
    dataDir: tmp,
    shareDir: tmp,
    port: 0,
    label: 'LazyBro',
    pollIntervalMs: 45_000,
    hostBaseUrl: baseUrl,
    outboundToken: 'lbpeer_' + 'a'.repeat(64),
    localPeerId: 'local',
    remotePeerId: 'remote',
    remoteLabel: 'Host',
    quotaBytes: 1024 * 1024,
    folderBackupPath: null,
    folderBackupIntervalMs: 0,
    lastFolderBackupAt: null,
    ageIdentity: null,
    ageRecipient: null,
    autostartPrompted: false,
    openUiOnStart: false,
    localApiToken: 'token',
  };
}

type Received = { index: number; chunks: number; total: number; bytes: Buffer };

function startServer(options?: { failWith?: { status: number; error: string } }) {
  const received: Received[] = [];
  let auth = '';
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: 0,
    async fetch(request) {
      auth = request.headers.get('authorization') || '';
      const url = new URL(request.url);
      if (options?.failWith) {
        return Response.json(
          { error: options.failWith.error },
          { status: options.failWith.status }
        );
      }
      const index = Number(url.searchParams.get('chunk'));
      const chunks = Number(url.searchParams.get('chunks'));
      const total = Number(url.searchParams.get('total'));
      received.push({
        index,
        chunks,
        total,
        bytes: Buffer.from(await request.arrayBuffer()),
      });
      return Response.json({ ok: true, done: index === chunks - 1 });
    },
  });
  return { server, received, getAuth: () => auth };
}

afterEach(async () => {
  await fs.rm(path.join(tmp, 'artifact.bin'), { force: true });
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('planRecallChunks', () => {
  test('matches the host layout', () => {
    expect(planRecallChunks(10, 4)).toEqual([
      { index: 0, start: 0, end: 4, length: 4 },
      { index: 1, start: 4, end: 8, length: 4 },
      { index: 2, start: 8, end: 10, length: 2 },
    ]);
  });
});

describe('recallUploadFailure', () => {
  test('surfaces the host error message and status', () => {
    const message = recallUploadFailure(
      { ok: false, status: 413 },
      JSON.stringify({ error: 'Recall upload exceeds maximum of 4 bytes' })
    );
    expect(message).toContain('413');
    expect(message).toContain('exceeds maximum');
  });
});

describe('uploadRecallChunks', () => {
  test.skipIf(!LAN_IP)('sends fixed-size chunks to a real HTTP host', async () => {
    const { server, received, getAuth } = startServer();
    try {
      const src = path.join(tmp, 'artifact.bin');
      await fs.writeFile(src, Buffer.from('abcdefghij'));
      const cfg = configFor(`http://${LAN_IP}:${server.port}`);

      await uploadRecallChunks(cfg, 'recall-1', src, 10, 4);

      expect(getAuth()).toStartWith('Bearer lbpeer_');
      expect(received.map((row) => row.index)).toEqual([0, 1, 2]);
      expect(received.map((row) => row.bytes.length)).toEqual([4, 4, 2]);
      expect(received.every((row) => row.chunks === 3 && row.total === 10)).toBe(true);
      expect(Buffer.concat(received.map((row) => row.bytes)).toString()).toBe('abcdefghij');
    } finally {
      server.stop(true);
    }
  });

  test.skipIf(!LAN_IP)('throws the host error for a rejected chunk', async () => {
    const { server } = startServer({
      failWith: { status: 413, error: 'Recall upload exceeds maximum of 4 bytes' },
    });
    try {
      const src = path.join(tmp, 'artifact.bin');
      await fs.writeFile(src, Buffer.from('abcdefghij'));
      const cfg = configFor(`http://${LAN_IP}:${server.port}`);

      let caught: unknown = null;
      try {
        await uploadRecallChunks(cfg, 'recall-2', src, 10, 4);
      } catch (error) {
        caught = error;
      }
      expect((caught as Error)?.message).toContain('413');
      expect((caught as Error)?.message).toContain('exceeds maximum');
    } finally {
      server.stop(true);
    }
  });
});
