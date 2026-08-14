import http from 'http';
import https from 'https';
import net from 'net';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  resolveHttpUrlAddresses,
  type LookupFn,
} from './url-guard-resolve';
import type { UrlGuardPolicy } from './url-guard';

type PinnedBody = RequestInit['body'] | NodeJS.ReadableStream;
export type PinnedRequestInit = Omit<RequestInit, 'body'> & { body?: PinnedBody };

export function createPinnedLookup(addresses: string[]) {
  const rows = addresses.map((address) => {
    const family = net.isIP(address);
    if (family !== 4 && family !== 6) {
      throw new Error(`Invalid resolved IP address: ${address}`);
    }
    return { address, family };
  });
  if (!rows.length) throw new Error('No resolved addresses to pin');

  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const wantsAll = typeof options === 'object' && options !== null && 'all' in options
      ? Boolean((options as { all?: boolean }).all)
      : false;
    if (wantsAll) {
      callback(null, rows);
    } else {
      callback(null, rows[0]!.address, rows[0]!.family);
    }
  }) as net.LookupFunction;
}

function responseHeaders(message: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function sendBody(
  request: http.ClientRequest,
  body: PinnedBody | null | undefined
): Promise<void> {
  if (body == null) {
    request.end();
    return;
  }
  if (typeof body === 'string' || body instanceof URLSearchParams) {
    request.end(body.toString());
    return;
  }
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    request.end(body);
    return;
  }
  if (body instanceof ArrayBuffer) {
    request.end(Buffer.from(body));
    return;
  }
  if (body instanceof Blob) {
    await pipeline(Readable.fromWeb(body.stream() as never), request);
    return;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    await pipeline(Readable.fromWeb(body as never), request);
    return;
  }
  if (typeof body === 'object' && body && 'pipe' in body) {
    await pipeline(body as NodeJS.ReadableStream, request);
    return;
  }
  request.destroy(new Error('Unsupported pinned request body'));
}

/**
 * Resolve once, enforce the URL policy, and pin that exact address set into
 * the socket lookup while retaining the original hostname for Host and TLS SNI.
 * Redirects are intentionally never followed.
 */
export async function pinnedFetch(
  rawUrl: string,
  policy: UrlGuardPolicy,
  init: PinnedRequestInit = {},
  options: { lookup?: LookupFn } = {}
): Promise<Response> {
  const resolved = await resolveHttpUrlAddresses(
    rawUrl,
    policy,
    options.lookup
  );
  if (!resolved.ok) throw new Error(resolved.error);

  const url = new URL(resolved.url);
  const transport = url.protocol === 'https:' ? https : http;
  const headers = new Headers(init.headers);
  const lookup = createPinnedLookup(resolved.addresses);

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        lookup,
        agent: false,
        signal: init.signal ?? undefined,
      },
      (message) => {
        const status = message.statusCode || 500;
        const hasNoBody =
          init.method?.toUpperCase() === 'HEAD' ||
          status === 101 ||
          status === 204 ||
          status === 205 ||
          status === 304;
        if (hasNoBody) message.resume();
        const body = hasNoBody
          ? null
          : (Readable.toWeb(message) as ReadableStream<Uint8Array>);
        resolve(
          new Response(body, {
            status,
            statusText: message.statusMessage,
            headers: responseHeaders(message),
          })
        );
      }
    );
    request.once('error', reject);
    void sendBody(request, init.body).catch((error) => {
      request.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
