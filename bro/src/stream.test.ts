import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { streamResponseToFile, sweepPartialFiles } from './stream';

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

describe('sweepPartialFiles', () => {
  test('removes crash leftovers and keeps real objects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-sweep-'));
    cleanup.push(dir);
    const objects = path.join(dir, 'objects');
    await fs.mkdir(path.join(objects, 'docs'), { recursive: true });
    await fs.writeFile(path.join(objects, 'docs', 'a.tar.gz.partial-1234'), 'half');
    await fs.writeFile(path.join(objects, 'b.sql.gz.partial-5678'), 'half');
    await fs.writeFile(path.join(objects, 'docs', 'keep.tar.gz.age'), 'whole');
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'escaped.partial-9999'), 'must stay');
    await fs.symlink(outside, path.join(objects, 'link'));

    expect(await sweepPartialFiles(objects)).toBe(2);

    await expect(fs.access(path.join(objects, 'docs', 'a.tar.gz.partial-1234'))).rejects.toThrow();
    await expect(fs.access(path.join(objects, 'b.sql.gz.partial-5678'))).rejects.toThrow();
    expect(await fs.readFile(path.join(objects, 'docs', 'keep.tar.gz.age'), 'utf8')).toBe('whole');
    expect(await fs.readFile(path.join(outside, 'escaped.partial-9999'), 'utf8')).toBe('must stay');
  });

  test('returns 0 for a missing objects dir', async () => {
    expect(await sweepPartialFiles('/tmp/lazybro-does-not-exist-objects')).toBe(0);
  });
});
