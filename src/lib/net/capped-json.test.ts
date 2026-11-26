import { describe, expect, test } from 'bun:test';
import {
  CappedJsonError,
  PEER_CONTROL_JSON_LIMIT,
  readCappedJson,
  readCappedRequestJson,
  readCappedResponseJson,
} from './capped-json';

function source(body: string, contentLength?: number) {
  return {
    headers: new Headers(
      contentLength == null ? {} : { 'Content-Length': String(contentLength) }
    ),
    body: new Response(body).body,
  };
}

describe('readCappedJson', () => {
  test('parses a body under the limit', async () => {
    const parsed = await readCappedJson(source('{"ok":true}', 11), 1024);
    expect(parsed).toEqual({ ok: true });
  });

  test('rejects a declared oversized body before reading it', async () => {
    await expect(
      readCappedJson(source('{"ok":true}', 10_000), 1024)
    ).rejects.toBeInstanceOf(CappedJsonError);
  });

  test('rejects a body that exceeds the limit while streaming', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(4096) });
    // Content-Length omitted on purpose: the streaming check must still fire.
    await expect(readCappedJson(source(body), 1024)).rejects.toBeInstanceOf(
      CappedJsonError
    );
  });

  test('rejects a lying (too small) Content-Length', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(4096) });
    await expect(readCappedJson(source(body, 8), 1024)).rejects.toBeInstanceOf(
      CappedJsonError
    );
  });

  test('caps response bodies at the shared peer control limit', async () => {
    const huge = new Response('x'.repeat(PEER_CONTROL_JSON_LIMIT + 1), {
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(
      readCappedResponseJson(huge, PEER_CONTROL_JSON_LIMIT)
    ).rejects.toBeInstanceOf(CappedJsonError);
  });

  test('rejects a missing body', async () => {
    await expect(
      readCappedJson({ headers: new Headers(), body: null }, 1024)
    ).rejects.toBeInstanceOf(CappedJsonError);
  });

  test('does not cancel a route request body when rejecting by length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readCappedRequestJson(
        { headers: new Headers({ 'Content-Length': '99999' }), body },
        1024
      )
    ).rejects.toBeInstanceOf(CappedJsonError);
    expect(cancelled).toBe(false);
  });
});
