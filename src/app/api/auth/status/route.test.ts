import { afterAll, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

// Preload the real barrels so the mocks keep every other export intact; other
// test files share the module registry in Bun.
const realAuth = await import(`../../../../lib/auth/index.ts?seed=${Date.now()}`);
const realWebauthn = await import(
  `../../../../lib/auth/webauthn.ts?seed=${Date.now()}`
);

let statusFixture: Record<string, unknown> = {};
let passkeyCountFixture = 0;
let refreshedCookie = false;

mock.module('@/lib/auth', () => ({
  ...realAuth,
  getAuthStatus: async () => ({ ...statusFixture }),
  maybeRefreshSessionCookie: async () => {
    refreshedCookie = true;
  },
}));

mock.module('@/lib/auth/webauthn', () => ({
  ...realWebauthn,
  countPasskeys: async () => passkeyCountFixture,
}));

const { GET } = await import('@/app/api/auth/status/route');

afterAll(async () => {
  // Module mocks are process-wide in Bun; restore real copies for later files.
  mock.restore();
  const freshAuth = await import(`../../../../lib/auth/index.ts?real=${Date.now()}`);
  mock.module('@/lib/auth', () => ({ ...freshAuth }));
  const freshWebauthn = await import(
    `../../../../lib/auth/webauthn.ts?real=${Date.now()}`
  );
  mock.module('@/lib/auth/webauthn', () => ({ ...freshWebauthn }));
});

function request() {
  return new NextRequest('http://127.0.0.1/api/auth/status');
}

describe('GET /api/auth/status passkeyCount', () => {
  test('reports the stored passkey count alongside existing fields', async () => {
    statusFixture = {
      authEnabled: true,
      authSetupCompleted: true,
      authenticated: true,
      hasPassword: true,
      hasPasskeys: true,
    };
    passkeyCountFixture = 2;
    refreshedCookie = false;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authEnabled: true,
      authSetupCompleted: true,
      authenticated: true,
      hasPassword: true,
      hasPasskeys: true,
      passkeyCount: 2,
    });
    expect(refreshedCookie).toBe(true);
  });

  test('returns 0 when no passkeys are registered', async () => {
    statusFixture = {
      authEnabled: false,
      authSetupCompleted: false,
      authenticated: true,
      hasPassword: false,
      hasPasskeys: false,
    };
    passkeyCountFixture = 0;

    const response = await GET(request());

    expect(await response.json()).toMatchObject({
      authEnabled: false,
      authenticated: true,
      hasPasskeys: false,
      passkeyCount: 0,
    });
  });

  test('adds the count to unauthenticated responses without changing them', async () => {
    statusFixture = {
      authEnabled: true,
      authSetupCompleted: true,
      authenticated: false,
      hasPassword: true,
      hasPasskeys: true,
    };
    passkeyCountFixture = 1;
    refreshedCookie = false;

    const response = await GET(request());

    expect(await response.json()).toEqual({
      authEnabled: true,
      authSetupCompleted: true,
      authenticated: false,
      hasPassword: true,
      hasPasskeys: true,
      passkeyCount: 1,
    });
    expect(refreshedCookie).toBe(false);
  });
});
