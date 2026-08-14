import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { streamResponseToFile } from './stream';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe('streamResponseToFile', () => {
  test('streams under the declared ceiling', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-stream-'));
    cleanup.push(dir);
    const dest = path.join(dir, 'object');
    const result = await streamResponseToFile({
      response: new Response('payload', { headers: { 'Content-Length': '7' } }),
      destPath: dest,
      maxBytes: 10,
      expectedBytes: 7,
    });
    expect(result.size).toBe(7);
    expect(await fs.readFile(dest, 'utf8')).toBe('payload');
  });

  test('rejects missing or excessive declared lengths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-stream-'));
    cleanup.push(dir);
    await expect(
      streamResponseToFile({
        response: new Response('x'),
        destPath: path.join(dir, 'missing'),
        maxBytes: 10,
      })
    ).rejects.toThrow(/Content-Length/i);
    await expect(
      streamResponseToFile({
        response: new Response('x', { headers: { 'Content-Length': '100' } }),
        destPath: path.join(dir, 'large'),
        maxBytes: 10,
      })
    ).rejects.toThrow(/maximum/i);
  });
});
