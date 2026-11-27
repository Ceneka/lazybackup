import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

process.env.NEXT_RUNTIME = 'nodejs';

type Row = Record<string, unknown> | null;
let historyFixture: Row = null;

const realAuth = await import(`../../../../../lib/auth/index.ts?real=${Date.now()}`);

mock.module('@/lib/db', () => ({
  db: {
    query: {
      backupHistory: {
        findFirst: async () => historyFixture,
      },
    },
  },
}));

// Keep every real export: a partial namespace would hide named exports from
// other test files that import @/lib/auth while this mock is installed.
mock.module('@/lib/auth', () => ({
  ...realAuth,
  resolveAuth: async () => ({
    authorized: true,
    via: 'bearer',
    apiToken: { id: 'tok', name: 'agent', permissions: ['read_only'] },
  }),
  authAllowsWrite: () => false,
}));

const { GET } = await import('@/app/api/history/[id]/download/route');

function request(id: string, query = '') {
  return new NextRequest(`http://127.0.0.1/api/history/${id}/download${query}`, {
    headers: { authorization: 'Bearer lb_readonly' },
  });
}

beforeEach(() => {
  historyFixture = null;
});

afterAll(async () => {
  // Bun patches module namespaces in place: restore full copies for later files.
  const freshDb = await import(`../../../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
  const freshAuth = await import(`../../../../../lib/auth/index.ts?real=${Date.now()}`);
  mock.module('@/lib/auth', () => freshAuth);
});

describe('GET download retry is a mutation', () => {
  test('read_only bearer cannot reset a failed recall through ?retry=1', async () => {
    historyFixture = {
      id: 'h1',
      status: 'success',
      artifactPath: 'peer://p1/backups/app.tar.gz.age',
      artifactRemoved: false,
      backupConfig: { destinationKind: 'peer' },
    };

    const response = await GET(request('h1', '?retry=1'), {
      params: Promise.resolve({ id: 'h1' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('read_only'),
    });
  });
});
