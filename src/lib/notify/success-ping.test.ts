import { describe, expect, test } from 'bun:test';
import {
  buildBackupSucceededPayload,
  postSuccessPing,
} from './success-ping';
import { parseSuccessPingMethod } from './presets';
import { validateFailureWebhookUrl } from './failure-webhook';

describe('parseSuccessPingMethod', () => {
  test('defaults to GET', () => {
    expect(parseSuccessPingMethod(undefined)).toBe('GET');
    expect(parseSuccessPingMethod('')).toBe('GET');
    expect(parseSuccessPingMethod('get')).toBe('GET');
    expect(parseSuccessPingMethod('POST')).toBe('POST');
    expect(parseSuccessPingMethod('PUT')).toBe('PUT');
  });
});

describe('buildBackupSucceededPayload', () => {
  test('builds expected shape', () => {
    const payload = buildBackupSucceededPayload({
      historyId: 'h1',
      configId: 'c1',
      backupName: 'Daily',
      endedAt: new Date('2026-08-10T12:00:00.000Z'),
    });
    expect(payload).toEqual({
      event: 'backup.succeeded',
      backupName: 'Daily',
      configId: 'c1',
      historyId: 'h1',
      endedAt: '2026-08-10T12:00:00.000Z',
    });
  });
});

describe('postSuccessPing', () => {
  test('GET skips body (Healthchecks style)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const result = await postSuccessPing(
      {
        url: 'https://hc-ping.com/uuid-here',
        method: 'GET',
        headersRaw: '',
        bodyTemplate: 'ignored',
      },
      buildBackupSucceededPayload({ historyId: 'h1' }),
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://hc-ping.com/uuid-here');
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
  });

  test('string config defaults to GET', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const result = await postSuccessPing(
      'https://hc-ping.com/abc',
      buildBackupSucceededPayload({ historyId: 'h1' }),
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].init?.method).toBe('GET');
  });

  test('POSTs default JSON when body empty', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const payload = buildBackupSucceededPayload({
      historyId: 'h1',
      backupName: 'Daily',
      endedAt: new Date('2026-08-10T12:00:00.000Z'),
    });

    const result = await postSuccessPing(
      {
        url: 'https://hooks.example.com/ok',
        method: 'POST',
        headersRaw: '',
        bodyTemplate: '',
      },
      payload,
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      event: 'backup.succeeded',
      historyId: 'h1',
      backupName: 'Daily',
    });
  });

  test('applies URL tags and headers', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const result = await postSuccessPing(
      {
        url: 'https://hooks.example.com/{{historyId}}',
        method: 'POST',
        headersRaw: 'X-Name: {{backupName}}',
        bodyTemplate: '{"ok":true,"name":"{{backupName}}"}',
      },
      buildBackupSucceededPayload({
        historyId: 'h1',
        backupName: 'Daily',
      }),
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://hooks.example.com/h1');
    expect(calls[0].init?.headers).toMatchObject({
      'X-Name': 'Daily',
    });
    expect(calls[0].init?.body).toBe('{"ok":true,"name":"Daily"}');
  });

  test('returns not ok on HTTP error without throwing', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 500 });
    const result = await postSuccessPing(
      'https://hc-ping.com/x',
      buildBackupSucceededPayload({ historyId: 'h1' }),
      { fetchImpl }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  test('returns not ok on invalid URL without throwing', async () => {
    const result = await postSuccessPing(
      'not-a-url',
      buildBackupSucceededPayload({ historyId: 'h1' })
    );
    expect(result.ok).toBe(false);
  });

  test('reuses webhook URL rules (https required, IMDS blocked)', () => {
    expect(validateFailureWebhookUrl('https://hc-ping.com/x').ok).toBe(true);
    expect(validateFailureWebhookUrl('http://example.com/x').ok).toBe(false);
    expect(validateFailureWebhookUrl('https://169.254.169.254/').ok).toBe(false);
  });
});
