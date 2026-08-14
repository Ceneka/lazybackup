import { describe, expect, test } from 'bun:test';
import http from 'http';
import { pinnedFetch } from './pinned-fetch';
import type { UrlGuardPolicy } from './url-guard';

const policy: UrlGuardPolicy = {
  allowPrivate: true,
  allowCgnat: true,
  allowHttp: true,
  label: 'Test URL',
};

describe('pinnedFetch', () => {
  test('connects through the validated address while retaining hostname Host', async () => {
    let host = '';
    const server = http.createServer((request, response) => {
      host = request.headers.host || '';
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '2' });
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    try {
      const response = await pinnedFetch(
        `http://rebind.test:${address.port}/`,
        policy,
        {},
        { lookup: async () => ['127.0.0.1'] }
      );
      expect(await response.text()).toBe('ok');
      expect(host).toBe(`rebind.test:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  test('rejects a disallowed resolved answer before connecting', async () => {
    const publicOnly = { ...policy, allowPrivate: false };
    await expect(
      pinnedFetch('https://rebind.test/', publicOnly, {}, {
        lookup: async () => ['169.254.169.254'],
      })
    ).rejects.toThrow(/disallowed/i);
  });

  test('supports successful no-content webhook responses', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    try {
      const response = await pinnedFetch(
        `http://no-content.test:${address.port}/`,
        policy,
        {},
        { lookup: async () => ['127.0.0.1'] }
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
