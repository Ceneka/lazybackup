import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { generateKeyPairSync } from 'crypto';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> | null;
let sshKeyFixture: Row = null;
let repoFixture: Row = null;
const writes: Array<{ kind: 'insert' | 'update'; values: unknown }> = [];

mock.module('@/lib/db', () => ({
  db: {
    query: {
      sshKeys: { findFirst: async () => sshKeyFixture },
      gitRepos: { findFirst: async () => repoFixture },
    },
    insert: () => ({
      values: async (values: unknown) => {
        writes.push({ kind: 'insert', values });
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          writes.push({ kind: 'update', values });
        },
      }),
    }),
  },
}));

const { POST } = await import('@/app/api/git-repos/route');
const { PUT } = await import('@/app/api/git-repos/[id]/route');

/** PKCS#1 PEM: ssh2 parses it, so the route accepts it as usable key material. */
const VALID_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const SSH_REPO = {
  name: 'repo',
  url: 'git@github.com:org/repo.git',
  sshKeyId: 'key-1',
};

function post(body: unknown) {
  return new NextRequest('http://127.0.0.1/api/git-repos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(body: unknown, id = 'repo-1') {
  return new NextRequest(`http://127.0.0.1/api/git-repos/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sshKeyFixture = null;
  repoFixture = null;
  writes.length = 0;
});

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore full copies for later files.
  mock.restore();
  const freshDb = await import(`../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('POST /api/git-repos sshKeyId reference', () => {
  test('a nonexistent key is 400, not 500', async () => {
    const response = await POST(post(SSH_REPO));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Selected SSH key not found',
      details: [{ path: ['sshKeyId'], message: 'Selected SSH key not found' }],
    });
    expect(writes).toHaveLength(0);
  });

  test('a stored key without usable material is 400', async () => {
    sshKeyFixture = { id: 'key-1', privateKeyContent: null, privateKeyPath: null };

    const response = await POST(post(SSH_REPO));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Selected SSH key is unusable'),
      details: [{ path: ['sshKeyId'] }],
    });
    expect(writes).toHaveLength(0);
  });

  test('a usable key is created', async () => {
    sshKeyFixture = { id: 'key-1', privateKeyContent: VALID_PRIVATE_KEY };

    const response = await POST(post(SSH_REPO));

    expect(response.status).toBe(201);
    expect(writes).toHaveLength(1);
    expect((writes[0].values as { sshKeyId: string }).sshKeyId).toBe('key-1');
  });

  test('HTTPS repos need no key reference', async () => {
    const response = await POST(
      post({ name: 'repo', url: 'https://github.com/org/repo.git' })
    );

    expect(response.status).toBe(201);
    expect(writes).toHaveLength(1);
  });
});

describe('PUT /api/git-repos/[id] sshKeyId reference', () => {
  beforeEach(() => {
    repoFixture = {
      id: 'repo-1',
      name: 'repo',
      url: 'git@github.com:org/repo.git',
      sshKeyId: 'key-1',
    };
  });

  test('a nonexistent key is 400 and the row is untouched', async () => {
    const response = await PUT(put(SSH_REPO), {
      params: Promise.resolve({ id: 'repo-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Selected SSH key not found',
      details: [{ path: ['sshKeyId'], message: 'Selected SSH key not found' }],
    });
    expect(writes).toHaveLength(0);
  });

  test('a stored key without usable material is 400', async () => {
    sshKeyFixture = { id: 'key-1', privateKeyContent: '', privateKeyPath: ' ' };

    const response = await PUT(put(SSH_REPO), {
      params: Promise.resolve({ id: 'repo-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Selected SSH key is unusable'),
      details: [{ path: ['sshKeyId'] }],
    });
    expect(writes).toHaveLength(0);
  });

  test('a usable key updates the row', async () => {
    sshKeyFixture = { id: 'key-1', privateKeyContent: VALID_PRIVATE_KEY };

    const response = await PUT(put(SSH_REPO), {
      params: Promise.resolve({ id: 'repo-1' }),
    });

    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe('update');
    expect((writes[0].values as { sshKeyId: string }).sshKeyId).toBe('key-1');
  });
});
