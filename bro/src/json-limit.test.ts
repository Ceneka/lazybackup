import { describe, expect, test } from 'bun:test';
import { JsonLimitError, readCappedJson } from './json-limit';

describe('readCappedJson', () => {
  test('parses a small response', async () => {
    const response = new Response('{"pulls":[]}', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await readCappedJson(response, 1024)).toEqual({ pulls: [] });
  });

  test('rejects an oversized declared response before reading', async () => {
    const response = new Response('{}', {
      headers: { 'Content-Length': '999999' },
    });
    await expect(readCappedJson(response, 1024)).rejects.toBeInstanceOf(JsonLimitError);
  });

  test('rejects an oversized streamed response', async () => {
    const response = new Response(JSON.stringify({ pad: 'x'.repeat(4096) }));
    await expect(readCappedJson(response, 1024)).rejects.toBeInstanceOf(JsonLimitError);
  });

  test('rejects a lying small Content-Length', async () => {
    const response = new Response(JSON.stringify({ pad: 'x'.repeat(4096) }), {
      headers: { 'Content-Length': '2' },
    });
    await expect(readCappedJson(response, 1024)).rejects.toBeInstanceOf(JsonLimitError);
  });
});
