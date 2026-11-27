import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;

let configFixture: Row = null;
let historyFixture: Row = null;
let serverFixture: Row = null;
let startBackupCalls = 0;
let startBackupImpl: (id: string) => Promise<string> = async () => 'h-started';
let restorePathImpl: (
  id: string,
  options: unknown
) => Promise<{ targetPath: string; log: string }> = async (
  _id,
  options
) => ({
  targetPath: (options as { targetPath?: string })?.targetPath || '/restored',
  log: '',
});
let connectToServerImpl: (server: unknown) => Promise<{ dispose: () => void }> =
  async () => ({ dispose() {} });
let connectCalls = 0;

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupConfigs: { findFirst: async () => configFixture },
      backupHistory: {
        findFirst: async () => historyFixture,
        findMany: async () => [],
      },
      servers: { findFirst: async () => serverFixture },
      sshKeys: { findFirst: async () => null },
      peers: { findFirst: async () => null },
      peerRecalls: { findFirst: async () => null },
      peerDeletes: { findFirst: async () => null },
      s3Profiles: { findFirst: async () => null },
    },
  },
}));

// Keep startBackup and the restore pipelines from touching the filesystem/SSH.
// Spread the real module: partial namespaces break other test files that load
// @/lib/backup while this mock is installed (Bun mocks are process-wide).
const realBackup = await import(
  `../../lib/backup/index.ts?real=${Date.now()}`
);

mock.module('@/lib/backup', () => ({
  ...realBackup,
  startBackup: (id: string) => {
    startBackupCalls += 1;
    return startBackupImpl(id);
  },
  restorePathBackup: (id: string, options: unknown) => restorePathImpl(id, options),
  restoreDatabaseBackup: async () => {
    throw new Error('restoreDatabaseBackup should not run in these tests');
  },
  restoreDockerVolumeBackup: async () => {
    throw new Error('restoreDockerVolumeBackup should not run in these tests');
  },
  restoreGitRepoBackup: async () => {
    throw new Error('restoreGitRepoBackup should not run in these tests');
  },
}));

// A real copy so the mock above can keep every export while overriding connect.
const realSsh = await import(`../../lib/ssh/index.ts?real=${Date.now()}`);

mock.module('@/lib/ssh', () => ({
  // Real module first: other modules (and later test files restored via
  // afterAll) import the full surface, not just the mocked entry point.
  ...realSsh,
  connectToServer: (server: unknown) => {
    connectCalls += 1;
    return connectToServerImpl(server);
  },
}));

const notFoundRoute = await import('@/app/api/[...notFound]/route');
const { POST: startBackupRoute } = await import('@/app/api/backups/start/route');
const { POST: restoreRoute } = await import(
  '@/app/api/history/[id]/restore/route'
);
const { BackupAlreadyRunningError } = await import(
  '@/lib/backup/concurrent-run'
);

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function restoreRequest(id: string, body: unknown): NextRequest {
  return jsonRequest(`/api/history/${id}/restore`, body);
}

function pathHistoryRow(overrides: Row = {}): Row {
  return {
    id: 'h-1',
    status: 'success',
    artifactPath: '/backups/app/2026-11-27_10-00-00',
    backupConfig: {
      sourceKind: 'server',
      sourceType: 'path',
      serverId: 'srv-1',
      sourcePath: '/srv/app',
      destinationKind: 'local',
      destinationPath: '/backups/app',
    },
    ...overrides,
  };
}

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore real copies for later files.
  mock.restore();
  const freshSsh = await import(`../../lib/ssh/index.ts?real=${Date.now()}`);
  mock.module('@/lib/ssh', () => freshSsh);
  const freshDb = await import(`../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  const freshBackup = await import(
    `../../lib/backup/index.ts?real=${Date.now()}`
  );
  mock.module('@/lib/backup', () => freshBackup);
});

beforeEach(() => {
  configFixture = null;
  historyFixture = null;
  serverFixture = null;
  startBackupCalls = 0;
  connectCalls = 0;
  startBackupImpl = async () => 'h-started';
  restorePathImpl = async (_id, options) => ({
    targetPath: (options as { targetPath?: string })?.targetPath || '/restored',
    log: '',
  });
  connectToServerImpl = async () => ({ dispose() {} });
});

describe('unknown /api/* paths', () => {
  test('every supported method answers JSON 404', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const handler = notFoundRoute[method];
      const response = await handler(
        new NextRequest('http://127.0.0.1/api/definitely-not-a-route', {
          method,
        })
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });
});

describe('POST /api/backups/start', () => {
  test('malformed JSON is a 400', async () => {
    const request = new NextRequest('http://127.0.0.1/api/backups/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });
    const response = await startBackupRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
  });

  test('a missing configId is a 404', async () => {
    const response = await startBackupRoute(
      jsonRequest('/api/backups/start', {})
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Backup configuration not found',
    });
    expect(startBackupCalls).toBe(0);
  });

  test('an unknown configId is a 404 without starting a backup', async () => {
    configFixture = null;
    const response = await startBackupRoute(
      jsonRequest('/api/backups/start', { configId: 'cfg-missing' })
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Backup configuration not found',
    });
    expect(startBackupCalls).toBe(0);
  });

  test('a known config still answers 201 with its history id', async () => {
    configFixture = { id: 'cfg-1' };
    startBackupImpl = async () => 'h-started';
    const response = await startBackupRoute(
      jsonRequest('/api/backups/start', { configId: 'cfg-1' })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      message: 'Backup started successfully',
      historyId: 'h-started',
    });
    expect(startBackupCalls).toBe(1);
  });

  test('an already-running backup is still a 409', async () => {
    configFixture = { id: 'cfg-1' };
    startBackupImpl = async () => {
      throw new BackupAlreadyRunningError('h-running', new Date());
    };
    const response = await startBackupRoute(
      jsonRequest('/api/backups/start', { configId: 'cfg-1' })
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { historyId?: string };
    expect(body.historyId).toBe('h-running');
  });
});

describe('POST /api/history/[id]/restore', () => {
  test('an unknown history id fails fast with a JSON 404', async () => {
    const response = await restoreRoute(restoreRequest('missing', { confirm: true }), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Backup history entry not found',
    });
  });

  test('target paths with traversal segments are a 400', async () => {
    historyFixture = pathHistoryRow();
    for (const targetPath of ['/srv/app/../etc', './srv/app', '/srv/./app']) {
      const response = await restoreRoute(
        restoreRequest('h-1', { confirm: true, targetPath }),
        { params: Promise.resolve({ id: 'h-1' }) }
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Target path must be normalized',
      });
    }
  });

  test('a normalized absolute path is still accepted', async () => {
    historyFixture = pathHistoryRow();
    const response = await restoreRoute(
      restoreRequest('h-1', { confirm: true, targetPath: '/srv/app-restored' }),
      { params: Promise.resolve({ id: 'h-1' }) }
    );
    expect(response.status).toBe(200);
    expect(connectCalls).toBe(0);
  });

  test('an unreachable retarget server is a 502 naming the server', async () => {
    historyFixture = pathHistoryRow();
    serverFixture = { id: 'srv-2', name: 'Prod 2', authType: 'key' };
    connectToServerImpl = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:22'), {
        code: 'ECONNREFUSED',
      });
    };

    const response = await restoreRoute(
      restoreRequest('h-1', {
        confirm: true,
        allowRetarget: true,
        targetServerId: 'srv-2',
        targetPath: '/srv/app',
      }),
      { params: Promise.resolve({ id: 'h-1' }) }
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(
      /^Restore on Prod 2 failed: .*ECONNREFUSED/
    );
  });

  test('an unparseable key is a 400 naming the server', async () => {
    historyFixture = pathHistoryRow();
    serverFixture = { id: 'srv-2', name: 'Prod 2', authType: 'key' };
    connectToServerImpl = async () => {
      throw new Error('Cannot parse privateKey: Unsupported key format');
    };

    const response = await restoreRoute(
      restoreRequest('h-1', {
        confirm: true,
        allowRetarget: true,
        targetServerId: 'srv-2',
        targetPath: '/srv/app',
      }),
      { params: Promise.resolve({ id: 'h-1' }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(
      'Restore on Prod 2 failed: Cannot parse privateKey: Unsupported key format'
    );
  });

  test('a password-only retarget server is a 400 without connecting', async () => {
    historyFixture = pathHistoryRow();
    serverFixture = { id: 'srv-2', name: 'Prod 2', authType: 'password' };

    const response = await restoreRoute(
      restoreRequest('h-1', {
        confirm: true,
        allowRetarget: true,
        targetServerId: 'srv-2',
        targetPath: '/srv/app',
      }),
      { params: Promise.resolve({ id: 'h-1' }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/^Restore on Prod 2 failed: needs SSH key/);
    expect(connectCalls).toBe(0);
  });

  test('an unknown retarget server is a 400', async () => {
    historyFixture = pathHistoryRow();
    serverFixture = null;

    const response = await restoreRoute(
      restoreRequest('h-1', {
        confirm: true,
        allowRetarget: true,
        targetServerId: 'srv-missing',
        targetPath: '/srv/app',
      }),
      { params: Promise.resolve({ id: 'h-1' }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(
      'Restore on srv-missing failed: target server not found'
    );
    expect(connectCalls).toBe(0);
  });
});
