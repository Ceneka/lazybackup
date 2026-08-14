import { describe, expect, test } from 'bun:test';
import {
  injectLocalApiToken,
  publicConfig,
  validateLocalControlRequest,
} from './control';
import type { BroConfig } from './config';

const token = 'a'.repeat(43);

function request(
  path: string,
  options: { method?: string; host?: string; origin?: string; token?: string; csrf?: string; type?: string } = {}
) {
  return new Request(`http://127.0.0.1:3789${path}`, {
    method: options.method || 'GET',
    headers: {
      Host: options.host || '127.0.0.1:3789',
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.token ? { 'X-LazyBro-Token': options.token } : {}),
      ...(options.csrf ? { 'X-LazyBro-CSRF': options.csrf } : {}),
      ...(options.type ? { 'Content-Type': options.type } : {}),
    },
  });
}

describe('LazyBro loopback control guard', () => {
  test('requires exact loopback Host and local API token', () => {
    expect(validateLocalControlRequest(request('/api/status'), 3789, token, { api: true }).ok).toBe(
      false
    );
    expect(
      validateLocalControlRequest(
        request('/api/status', { host: 'attacker.example', token }),
        3789,
        token,
        { api: true }
      ).ok
    ).toBe(false);
    expect(
      validateLocalControlRequest(request('/api/status', { token }), 3789, token, { api: true }).ok
    ).toBe(true);
  });

  test('blocks foreign origins and requires JSON plus CSRF on mutations', () => {
    expect(
      validateLocalControlRequest(
        request('/api/config', {
          method: 'POST',
          origin: 'https://evil.example',
          token,
          csrf: '1',
          type: 'application/json',
        }),
        3789,
        token,
        { api: true }
      ).ok
    ).toBe(false);
    expect(
      validateLocalControlRequest(
        request('/api/config', { method: 'POST', token, type: 'text/plain' }),
        3789,
        token,
        { api: true }
      ).ok
    ).toBe(false);
    expect(
      validateLocalControlRequest(
        request('/api/config', {
          method: 'POST',
          token,
          csrf: '1',
          type: 'application/json; charset=utf-8',
        }),
        3789,
        token,
        { api: true }
      ).ok
    ).toBe(true);
  });
});

describe('LazyBro response redaction', () => {
  test('public config and injected HTML do not serialize stored secrets', () => {
    const cfg = {
      shareDir: '/share',
      label: 'Bro',
      hostBaseUrl: 'https://host.example',
      remoteLabel: 'Friend',
      quotaBytes: 10,
      folderBackupPath: null,
      lastFolderBackupAt: null,
      autostartPrompted: false,
      port: 3789,
      outboundToken: 'lbpeer_secret',
      ageIdentity: 'AGE-SECRET-KEY-secret',
      localApiToken: token,
    } as BroConfig;
    const serialized = JSON.stringify(publicConfig(cfg));
    expect(serialized).not.toContain('lbpeer_secret');
    expect(serialized).not.toContain('AGE-SECRET');
    expect(serialized).not.toContain(token);
    expect(injectLocalApiToken('token=__LAZYBRO_API_TOKEN__', token)).toBe(`token=${token}`);
  });
});
