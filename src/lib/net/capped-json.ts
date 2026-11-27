/**
 * Read request/response JSON with a hard byte ceiling.
 *
 * Peer-facing routes and the mailbox sync loop parse JSON supplied by the
 * other side of the trust boundary. `request.json()` / `response.json()`
 * buffer without limit, so a malicious peer could make the process allocate
 * gigabytes. These helpers reject on the declared Content-Length and again
 * while streaming, so a lie in the header cannot bypass the cap.
 */

export class CappedJsonError extends Error {
  status: number;
  constructor(message: string, status = 413) {
    super(message);
    this.name = 'CappedJsonError';
    this.status = status;
  }
}

export const PEER_CONTROL_JSON_LIMIT = 4 * 1024 * 1024;
export const PEER_PAIR_JSON_LIMIT = 64 * 1024;
export const PEER_PAIR_RESPONSE_JSON_LIMIT = 256 * 1024;
/** Small status report body (C3); anything bigger is not a real peer. */
export const PEER_STATUS_JSON_LIMIT = 4 * 1024;

function declaredLength(headers: Headers): number | null {
  const raw = headers.get('content-length')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function cancelQuietly(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    /* already closed / locked */
  }
}

type JsonSource = {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

async function readCappedJsonInternal(
  source: JsonSource,
  maxBytes: number,
  cancelOnLimit: boolean
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new CappedJsonError('Invalid JSON size limit', 500);
  }

  const declared = declaredLength(source.headers);
  if (declared != null && declared > maxBytes) {
    // Requests: leave the body alone. Cancelling it can make Next fail while
    // it wraps the request again to render a response ("body disturbed").
    if (cancelOnLimit) await cancelQuietly(source.body);
    throw new CappedJsonError(`JSON body exceeds the ${maxBytes} byte limit`);
  }
  if (!source.body) {
    throw new CappedJsonError('JSON body is required', 400);
  }

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new CappedJsonError(`JSON body exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (cancelOnLimit) await reader.cancel().catch(() => {});
    throw error;
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  return JSON.parse(text) as unknown;
}

export function readCappedJson(source: JsonSource, maxBytes: number): Promise<unknown> {
  return readCappedJsonInternal(source, maxBytes, true);
}

/** Read a peer/host JSON response under a byte ceiling. */
export function readCappedResponseJson(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  return readCappedJsonInternal(
    { headers: response.headers, body: response.body },
    maxBytes,
    true
  );
}

/** Read an incoming route body under a byte ceiling. */
export function readCappedRequestJson(
  request: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number
): Promise<unknown> {
  return readCappedJsonInternal(request, maxBytes, false);
}
