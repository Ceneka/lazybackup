import { describe, expect, test } from 'bun:test';
import {
  applyWebhookTemplate,
  applyWebhookUrlTemplate,
  buildBackupFailedPayload,
  parseWebhookHeaders,
  parseWebhookMethod,
  postFailureWebhook,
  validateFailureWebhookUrl,
} from './failure-webhook';

describe('validateFailureWebhookUrl', () => {
  test('rejects empty', () => {
    expect(validateFailureWebhookUrl('').ok).toBe(false);
    expect(validateFailureWebhookUrl(null).ok).toBe(false);
  });

  test('accepts https', () => {
    const result = validateFailureWebhookUrl('https://hooks.example.com/x');
    expect(result).toEqual({ ok: true, url: 'https://hooks.example.com/x' });
  });

  test('accepts http localhost', () => {
    expect(validateFailureWebhookUrl('http://localhost:9999/hook').ok).toBe(true);
    expect(validateFailureWebhookUrl('http://127.0.0.1/hook').ok).toBe(true);
    expect(validateFailureWebhookUrl('http://192.168.1.10/hook').ok).toBe(true);
  });

  test('rejects http public hosts', () => {
    const result = validateFailureWebhookUrl('http://example.com/hook');
    expect(result.ok).toBe(false);
  });

  test('rejects non-http schemes', () => {
    expect(validateFailureWebhookUrl('ftp://example.com/x').ok).toBe(false);
  });
});

describe('buildBackupFailedPayload', () => {
  test('builds expected shape', () => {
    const payload = buildBackupFailedPayload({
      historyId: 'h1',
      errorMessage: 'boom',
      configId: 'c1',
      backupName: 'Daily',
      endedAt: new Date('2026-08-10T12:00:00.000Z'),
    });
    expect(payload).toEqual({
      event: 'backup.failed',
      backupName: 'Daily',
      configId: 'c1',
      historyId: 'h1',
      errorMessage: 'boom',
      endedAt: '2026-08-10T12:00:00.000Z',
    });
  });
});

describe('applyWebhookTemplate', () => {
  test('replaces known tags', () => {
    expect(
      applyWebhookTemplate('Hi {{backupName}}: {{errorMessage}}', {
        backupName: 'Daily',
        errorMessage: 'nope',
      })
    ).toBe('Hi Daily: nope');
  });

  test('leaves unknown tags', () => {
    expect(applyWebhookTemplate('{{unknown}}', {})).toBe('{{unknown}}');
  });

  test('URL template encodes values', () => {
    expect(
      applyWebhookUrlTemplate('https://x/?msg={{errorMessage}}', {
        errorMessage: 'disk full & busy',
      })
    ).toBe('https://x/?msg=disk%20full%20%26%20busy');
  });
});

describe('parseWebhookHeaders', () => {
  test('parses line format', () => {
    const result = parseWebhookHeaders('Authorization: Bearer x\nX-Custom: 1');
    expect(result).toEqual({
      ok: true,
      headers: { Authorization: 'Bearer x', 'X-Custom': '1' },
    });
  });

  test('parses JSON object', () => {
    const result = parseWebhookHeaders('{"Authorization":"Bearer x"}');
    expect(result).toEqual({ ok: true, headers: { Authorization: 'Bearer x' } });
  });

  test('rejects bad line', () => {
    expect(parseWebhookHeaders('NoColon').ok).toBe(false);
  });
});

describe('parseWebhookMethod', () => {
  test('defaults to POST', () => {
    expect(parseWebhookMethod(undefined)).toBe('POST');
    expect(parseWebhookMethod('get')).toBe('GET');
    expect(parseWebhookMethod('PUT')).toBe('PUT');
  });
});

describe('postFailureWebhook', () => {
  test('POSTs JSON and returns ok on 200', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const payload = buildBackupFailedPayload({
      historyId: 'h1',
      errorMessage: 'fail',
      endedAt: new Date('2026-08-10T12:00:00.000Z'),
    });

    const result = await postFailureWebhook('https://hooks.example.com/x', payload, {
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.example.com/x');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      event: 'backup.failed',
      historyId: 'h1',
    });
  });

  test('applies custom body, headers, and URL tags', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const payload = buildBackupFailedPayload({
      historyId: 'h1',
      backupName: 'Daily',
      errorMessage: 'boom',
      endedAt: new Date('2026-08-10T12:00:00.000Z'),
    });

    const result = await postFailureWebhook(
      {
        url: 'https://hooks.example.com/{{historyId}}',
        method: 'POST',
        headersRaw: 'X-Name: {{backupName}}\nContent-Type: application/json',
        bodyTemplate: '{"text":"{{errorMessage}}"}',
      },
      payload,
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://hooks.example.com/h1');
    expect(calls[0].init?.headers).toMatchObject({
      'X-Name': 'Daily',
      'Content-Type': 'application/json',
    });
    expect(calls[0].init?.body).toBe('{"text":"boom"}');
  });

  test('GET skips body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const result = await postFailureWebhook(
      {
        url: 'https://kuma.example.com/api/push/t?msg={{errorMessage}}',
        method: 'GET',
        headersRaw: '',
        bodyTemplate: 'ignored',
      },
      buildBackupFailedPayload({ historyId: 'h1', errorMessage: 'x y' }),
      { fetchImpl }
    );
    expect(result.ok).toBe(true);
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].url).toContain('msg=x%20y');
  });

  test('returns not ok on HTTP error without throwing', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 500 });
    const result = await postFailureWebhook(
      'https://hooks.example.com/x',
      buildBackupFailedPayload({ historyId: 'h1', errorMessage: 'x' }),
      { fetchImpl }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  test('returns not ok on invalid URL without throwing', async () => {
    const result = await postFailureWebhook(
      'not-a-url',
      buildBackupFailedPayload({ historyId: 'h1', errorMessage: 'x' })
    );
    expect(result.ok).toBe(false);
  });
});
