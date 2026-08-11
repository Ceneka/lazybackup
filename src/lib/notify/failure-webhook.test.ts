import { describe, expect, test } from 'bun:test';
import {
  buildBackupFailedPayload,
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
