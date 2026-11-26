import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import * as realPairing from '@/lib/peer/pairing';
import * as realReports from '@/lib/peer/reports';

process.env.NEXT_RUNTIME = 'nodejs';

let authorized = true;
let reports: Array<{ peerId: string; report: Record<string, unknown> }> = [];

mock.module('@/lib/peer/pairing', () => ({
  verifyPeerBearer: async () => (authorized ? { id: 'peer_1', status: 'active' } : null),
  touchPeerSeen: async () => {},
}));

mock.module('@/lib/peer/reports', () => ({
  REMOTE_LAST_ERROR_MAX: 500,
  recordPeerReport: async (peerId: string, report: Record<string, unknown>) => {
    reports.push({ peerId, report });
  },
}));

const { GET, POST } = await import('@/app/api/peers/agent/ping/route');

function request(body?: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://127.0.0.1/api/peers/agent/ping', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer lbpeer_test',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body,
  });
}

afterAll(() => {
  mock.module('@/lib/peer/pairing', () => realPairing);
  mock.module('@/lib/peer/reports', () => realReports);
});

describe('peer agent ping route', () => {
  beforeEach(() => {
    authorized = true;
    reports = [];
  });

  test('GET still works for old clients', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; peerId: string };
    expect(body.ok).toBe(true);
    expect(body.peerId).toBe('peer_1');
    expect(reports).toHaveLength(0);
  });

  test('GET and POST reject a missing or invalid peer bearer', async () => {
    authorized = false;
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request('{}'))).status).toBe(401);
    expect(reports).toHaveLength(0);
  });

  test('POST stores a valid report and touches presence', async () => {
    const res = await POST(
      request(
        JSON.stringify({
          usedBytes: 1234,
          quotaBytes: 10_000,
          pendingPulls: 2,
          pendingRecalls: 1,
          lastSyncAt: '2026-01-02T03:04:05.000Z',
          lastError: null,
          appVersion: '0.2.7',
        })
      )
    );
    expect(res.status).toBe(200);
    expect(reports).toHaveLength(1);
    expect(reports[0].peerId).toBe('peer_1');
    expect(reports[0].report.usedBytes).toBe(1234);
    expect(reports[0].report.quotaBytes).toBe(10_000);
    expect(reports[0].report.pendingPulls).toBe(2);
    expect((reports[0].report.lastSyncAt as Date).toISOString()).toBe(
      '2026-01-02T03:04:05.000Z'
    );
    expect(reports[0].report.appVersion).toBe('0.2.7');
  });

  test('POST rejects bodies over 4 KiB', async () => {
    const body = JSON.stringify({ appVersion: 'x', lastError: 'a'.repeat(5000) });
    expect(body.length).toBeGreaterThan(4096);
    const res = await POST(request(body));
    expect(res.status).toBe(413);
    expect(reports).toHaveLength(0);
  });

  test('POST validates field ranges and timestamps', async () => {
    expect((await POST(request(JSON.stringify({ usedBytes: -1 })))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ pendingPulls: 1.5 })))).status).toBe(400);
    expect(
      (await POST(request(JSON.stringify({ lastSyncAt: 'not-a-date' })))).status
    ).toBe(400);
    expect(reports).toHaveLength(0);
  });

  test('POST truncates a long lastError to 500 chars', async () => {
    const res = await POST(request(JSON.stringify({ lastError: 'e'.repeat(900) })));
    expect(res.status).toBe(200);
    expect(reports[0].report.lastError).toHaveLength(500);
  });
});
