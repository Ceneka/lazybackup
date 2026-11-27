/**
 * Parse JSON from the host with a hard byte ceiling.
 *
 * The host is the other side of the trust boundary: work lists, pairing
 * responses and error bodies are attacker-controlled if the host is
 * malicious. `response.json()` buffers without limit.
 */

export class JsonLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLimitError';
  }
}

export async function readCappedJson(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new JsonLimitError('Invalid JSON size limit');
  }

  const rawLength = response.headers.get('content-length')?.trim();
  if (rawLength && /^\d+$/.test(rawLength)) {
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new JsonLimitError(`Response exceeds the ${maxBytes} byte JSON limit`);
    }
  }

  if (!response.body) {
    throw new JsonLimitError('Response body is missing');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new JsonLimitError(`Response exceeds the ${maxBytes} byte JSON limit`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
}
