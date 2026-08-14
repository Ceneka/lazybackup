import { timingSafeEqual } from 'crypto';
import type { BroConfig } from './config';

export const LOCAL_API_TOKEN_HEADER = 'x-lazybro-token';
export const LOCAL_CSRF_HEADER = 'x-lazybro-csrf';

export function publicConfig(cfg: BroConfig) {
  return {
    shareDir: cfg.shareDir,
    label: cfg.label,
    hostBaseUrl: cfg.hostBaseUrl,
    remoteLabel: cfg.remoteLabel,
    quotaBytes: cfg.quotaBytes,
    folderBackupPath: cfg.folderBackupPath,
    lastFolderBackupAt: cfg.lastFolderBackupAt,
    autostartPrompted: cfg.autostartPrompted,
    port: cfg.port,
  };
}

function exactSecretMatch(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function allowedHosts(port: number): Set<string> {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (port === 80) {
    hosts.add('127.0.0.1');
    hosts.add('localhost');
    hosts.add('[::1]');
  }
  return hosts;
}

function allowedOrigins(port: number): Set<string> {
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  if (port === 80) {
    origins.add('http://127.0.0.1');
    origins.add('http://localhost');
    origins.add('http://[::1]');
  }
  return origins;
}

export function validateLocalControlRequest(
  request: Request,
  port: number,
  apiToken: string,
  options: { api?: boolean } = {}
): { ok: true } | { ok: false; status: number; error: string } {
  const host = request.headers.get('host')?.trim().toLowerCase();
  if (!host || !allowedHosts(port).has(host)) {
    return { ok: false, status: 403, error: 'Invalid Host' };
  }

  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins(port).has(origin.toLowerCase())) {
    return { ok: false, status: 403, error: 'Invalid Origin' };
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return { ok: false, status: 403, error: 'Cross-site request blocked' };
  }

  if (!options.api) return { ok: true };
  if (!exactSecretMatch(request.headers.get(LOCAL_API_TOKEN_HEADER), apiToken)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get(LOCAL_CSRF_HEADER) !== '1') {
      return { ok: false, status: 403, error: 'CSRF check failed' };
    }
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return { ok: false, status: 415, error: 'Content-Type must be application/json' };
    }
  }

  return { ok: true };
}

export function injectLocalApiToken(html: string, apiToken: string): string {
  return html.replace('__LAZYBRO_API_TOKEN__', apiToken);
}
