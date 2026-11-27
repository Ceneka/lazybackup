import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

let stored: Row | null = null;
const inserted: Row[] = [];
const updated: Row[] = [];

mock.module('@/lib/auth', () => ({
  resolveAuth: async () => ({ authorized: true, via: 'session' }),
}));

mock.module('@/lib/db', () => ({
  db: {
    query: {
      s3Profiles: {
        findFirst: async () => stored,
      },
    },
    insert: () => ({
      values: async (values: Row) => {
        inserted.push(values);
      },
    }),
    update: () => ({
      set: (values: Row) => ({
        where: async () => {
          updated.push(values);
          stored = stored ? { ...stored, ...values } : stored;
        },
      }),
    }),
  },
}));

const { POST } = await import('@/app/api/s3-profiles/route');
const { PUT } = await import('@/app/api/s3-profiles/[id]/route');

const validBody = {
  name: 'Backups',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'my-backups',
  accessKeyId: 'AKIA123',
  secretAccessKey: 'super-secret',
  forcePathStyle: true,
};

function storedProfile(overrides: Row = {}): Row {
  return {
    id: 's3-1',
    name: 'Old profile',
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'legacy-bucket',
    accessKeyId: 'AKIAOLD',
    secretAccessKey: 'old-secret',
    forcePathStyle: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function post(body: unknown) {
  return new NextRequest('http://127.0.0.1/api/s3-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(body: unknown) {
  return new NextRequest('http://127.0.0.1/api/s3-profiles/s3-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id = 's3-1') {
  return { params: Promise.resolve({ id }) };
}

const originalAllowPrivate = process.env.ALLOW_PRIVATE_S3_ENDPOINTS;

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  stored = storedProfile();
  delete process.env.ALLOW_PRIVATE_S3_ENDPOINTS;
});

afterAll(async () => {
  if (originalAllowPrivate === undefined) {
    delete process.env.ALLOW_PRIVATE_S3_ENDPOINTS;
  } else {
    process.env.ALLOW_PRIVATE_S3_ENDPOINTS = originalAllowPrivate;
  }
  mock.restore();
  const freshAuth = await import(`../../../lib/auth/index.ts?real=${Date.now()}`);
  mock.module('@/lib/auth', () => freshAuth);
  const freshDb = await import(`../../../lib/db/index.ts?real=${Date.now()}`);
  mock.module('@/lib/db', () => freshDb);
});

describe('POST /api/s3-profiles write validation', () => {
  test('rejects an unusable bucket name with a field-path issue', async () => {
    const response = await POST(post({ ...validBody, bucket: 'bad bucket name' }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      details: Array<{ path: string[]; message: string }>;
    };
    expect(body.details).toHaveLength(1);
    expect(body.details[0]!.path).toEqual(['bucket']);
    expect(body.details[0]!.message).toContain('lowercase');
    expect(body.error).toBe(body.details[0]!.message);
    expect(inserted).toHaveLength(0);
  });

  test('rejects loopback endpoints and names the opt-in env var', async () => {
    const response = await POST(
      post({ ...validBody, endpoint: 'http://127.0.0.1:9000' })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      details: Array<{ path: string[]; message: string }>;
    };
    expect(body.details[0]!.path).toEqual(['endpoint']);
    expect(body.details[0]!.message).toContain('ALLOW_PRIVATE_S3_ENDPOINTS=true');
    expect(inserted).toHaveLength(0);
  });

  test('rejects RFC1918 and metadata endpoints', async () => {
    for (const endpoint of ['http://192.168.1.20:9000', 'http://169.254.169.254']) {
      const response = await POST(post({ ...validBody, endpoint }));
      expect(response.status).toBe(400);
    }
    expect(inserted).toHaveLength(0);
  });

  test('accepts a valid profile and redacts the secret', async () => {
    const response = await POST(post(validBody));

    expect(response.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ bucket: 'my-backups' });
    const body = (await response.json()) as Row;
    expect(body.secretAccessKey).toBeUndefined();
    expect(body.hasSecretAccessKey).toBe(true);
  });

  test('ALLOW_PRIVATE_S3_ENDPOINTS=true allows a LAN MinIO endpoint', async () => {
    process.env.ALLOW_PRIVATE_S3_ENDPOINTS = 'true';
    const response = await POST(
      post({ ...validBody, endpoint: 'http://127.0.0.1:9000' })
    );

    expect(response.status).toBe(201);
    expect(inserted).toHaveLength(1);
  });
});

describe('PUT /api/s3-profiles/[id] write validation', () => {
  test('rejects an invalid incoming bucket', async () => {
    const response = await PUT(
      put({ ...validBody, bucket: 'UPPER' }),
      params()
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      details: Array<{ path: string[]; message: string }>;
    };
    expect(body.details[0]!.path).toEqual(['bucket']);
    expect(updated).toHaveLength(0);
  });

  test('does not let an old invalid stored bucket block a valid edit', async () => {
    stored = storedProfile({ bucket: 'INVALID STORED BUCKET' });

    const response = await PUT(
      put({ ...validBody, name: 'Renamed', bucket: 'fresh-bucket' }),
      params()
    );

    expect(response.status).toBe(200);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ name: 'Renamed', bucket: 'fresh-bucket' });
  });

  test('rejects a private endpoint on update', async () => {
    const response = await PUT(
      put({ ...validBody, endpoint: 'http://10.1.2.3:9000' }),
      params()
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      details: Array<{ path: string[]; message: string }>;
    };
    expect(body.details[0]!.path).toEqual(['endpoint']);
    expect(body.details[0]!.message).toContain('ALLOW_PRIVATE_S3_ENDPOINTS=true');
    expect(updated).toHaveLength(0);
  });

  test('keeps the stored secret when the update sends a blank one', async () => {
    const response = await PUT(
      put({ ...validBody, secretAccessKey: '' }),
      params()
    );

    expect(response.status).toBe(200);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ secretAccessKey: 'old-secret' });
    const body = (await response.json()) as Row;
    expect(body.secretAccessKey).toBeUndefined();
    expect(body.hasSecretAccessKey).toBe(true);
  });
});
