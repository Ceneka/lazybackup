import { beforeEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';

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

describe('POST /api/auth/login content type', () => {
  test('rejects a text/plain body before parsing it', async () => {
    // A cross-site form can only send simple content types; crafting this body
    // as application/x-www-form-urlencoded or text/plain must not reach Zod.
    // The 415 is returned before any password/DB work happens.
    const response = await POST(request('text/plain', '{"password":"x"}'));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('application/json'),
    });
  });

  test('rejects a form-urlencoded body', async () => {
    const response = await POST(
      request('application/x-www-form-urlencoded', 'password=x')
    );
    expect(response.status).toBe(415);
  });
});
