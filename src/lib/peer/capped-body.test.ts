import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sweepOrphanPeerUploadTemps, writeCappedResponseToFile } from './capped-body';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe('writeCappedResponseToFile', () => {
  test('streams a declared response to disk and hashes it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-response-'));
    cleanup.push(dir);
    const dest = path.join(dir, 'object');
    const result = await writeCappedResponseToFile({
      response: new Response('hello', { headers: { 'Content-Length': '5' } }),
      destPath: dest,
      maxBytes: 10,
      expectedBytes: 5,
    });
    expect(result.size).toBe(5);
    expect(await fs.readFile(dest, 'utf8')).toBe('hello');
  });

  test('requires Content-Length and enforces the ceiling before reading', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-response-'));
    cleanup.push(dir);
    const dest = path.join(dir, 'object');
    await expect(
      writeCappedResponseToFile({
        response: new Response('hello'),
        destPath: dest,
        maxBytes: 10,
      })
    ).rejects.toThrow(/Content-Length/i);
    await expect(
      writeCappedResponseToFile({
        response: new Response('hello', { headers: { 'Content-Length': '50' } }),
        destPath: dest,
        maxBytes: 10,
      })
    ).rejects.toThrow(/maximum/i);
  });
});

describe('sweepOrphanPeerUploadTemps', () => {
  test('removes upload temp dirs older than one hour and keeps active ones', async () => {
    const oldDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-upload-old-'));
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-peer-upload-fresh-'));
    cleanup.push(oldDir, freshDir);
    const oldTime = new Date(Date.now() - 2 * 3600_000);
    await fs.utimes(oldDir, oldTime, oldTime);

    const removed = await sweepOrphanPeerUploadTemps(3600_000);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await fs.stat(oldDir).catch(() => null)).toBeNull();
    expect(await fs.stat(freshDir).catch(() => null)).not.toBeNull();
  });
});
