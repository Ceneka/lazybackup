import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

mock.module('@/lib/auth', () => ({
  getPasswordHash: async () => 'stored-hash',
  verifyPassword: async () => true,
  createSessionCookieValue: async () => 'session-token',
  SESSION_COOKIE_NAME: 'lb_session',
  sessionCookieOptions: () => ({ httpOnly: true }),
}));

const { resetRateLimitForTests } = await import('@/lib/auth/rate-limit');
const { POST } = await import('@/app/api/auth/login/route');

function request(contentType: string, body: string) {
  return new NextRequest('http://127.0.0.1/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

beforeEach(() => {
  resetRateLimitForTests();
});

afterAll(async () => {
  const freshAuth = await import(`../../../../lib/auth/index.ts?real=${Date.now()}`);
  mock.module('@/lib/auth', () => freshAuth);
});

describe('POST /api/auth/login content type', () => {
  test('rejects a text/plain body before parsing it', async () => {
    // A cross-site form can only send simple content types; crafting this body
    // as application/x-www-form-urlencoded or text/plain must not reach Zod.
    const response = await POST(request('text/plain', '{"password":"x"}'));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('application/json'),
    });
  });

  test('still accepts JSON', async () => {
    const response = await POST(request('application/json', '{"password":"x"}'));
    expect(response.status).toBe(200);
  });
});
