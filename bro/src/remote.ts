import { lookup as dnsLookup } from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

type RemoteBody = RequestInit['body'] | NodeJS.ReadableStream;
export type RemoteRequestInit = Omit<RequestInit, 'body'> & { body?: RemoteBody };

function blockedAddress(address: string): boolean {
  let ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (net.isIPv4(mapped)) {
      ip = mapped;
    } else {
      const match = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
      if (match) {
        const hi = parseInt(match[1]!, 16);
        const lo = parseInt(match[2]!, 16);
        ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      }
    }
  }
  if (ip === '100.100.100.200' || ip === 'fd00:ec2::254') return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a! >= 224
    );
  }
  if (net.isIPv6(ip)) {
    return (
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fe8') ||
      ip.startsWith('fe9') ||
      ip.startsWith('fea') ||
      ip.startsWith('feb') ||
      ip.startsWith('ff')
    );
  }
  return true;
}

export async function resolveSafeRemoteUrl(raw: string): Promise<{
  url: URL;
  addresses: string[];
}> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Remote URL is invalid');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('Remote URL must be http(s) without credentials or fragments');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.metadata.google.internal')
  ) {
    throw new Error('Remote URL targets a blocked host');
  }
  const addresses = net.isIP(host)
    ? [host]
    : (await dnsLookup(host, { all: true, verbatim: true })).map((row) => row.address);
  if (!addresses.length || addresses.some(blockedAddress)) {
    throw new Error('Remote URL targets a blocked address');
  }
  return { url, addresses: [...new Set(addresses)] };
}

function pinnedLookup(addresses: string[]) {
  const rows = addresses.map((address) => ({ address, family: net.isIP(address) as 4 | 6 }));
  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const all =
      typeof options === 'object' &&
      options !== null &&
      Boolean((options as { all?: boolean }).all);
    if (all) callback(null, rows);
    else callback(null, rows[0]!.address, rows[0]!.family);
  }) as net.LookupFunction;
}

async function sendBody(request: http.ClientRequest, body: RemoteBody | null | undefined) {
  if (body == null) return request.end();
  if (typeof body === 'string' || body instanceof URLSearchParams) {
    return request.end(body.toString());
  }
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) return request.end(body);
  if (body instanceof ArrayBuffer) return request.end(Buffer.from(body));
  if (body instanceof Blob) {
    await pipeline(Readable.fromWeb(body.stream() as never), request);
    return;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    await pipeline(Readable.fromWeb(body as never), request);
    return;
  }
  await pipeline(body as NodeJS.ReadableStream, request);
}

export async function safeRemoteFetch(
  rawUrl: string,
  init: RemoteRequestInit = {}
): Promise<Response> {
  const resolved = await resolveSafeRemoteUrl(rawUrl);
  const transport = resolved.url.protocol === 'https:' ? https : http;
  const headers = new Headers(init.headers);
  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      resolved.url,
      {
        method: init.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        lookup: pinnedLookup(resolved.addresses),
        agent: false,
        signal: init.signal ?? undefined,
      },
      (message) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(message.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        const status = message.statusCode || 500;
        const hasNoBody =
          init.method?.toUpperCase() === 'HEAD' ||
          status === 101 ||
          status === 204 ||
          status === 205 ||
          status === 304;
        if (hasNoBody) message.resume();
        resolve(
          new Response(hasNoBody ? null : (Readable.toWeb(message) as never), {
            status,
            statusText: message.statusMessage,
            headers: responseHeaders,
          })
        );
      }
    );
    request.once('error', reject);
    void sendBody(request, init.body).catch((error) =>
      request.destroy(error instanceof Error ? error : new Error(String(error)))
    );
  });
}
