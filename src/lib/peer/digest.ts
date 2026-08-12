import { createHash, timingSafeEqual } from 'crypto';
import { createReadStream } from 'fs';

export function sha256Buffer(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  const ba = Buffer.from(left, 'hex');
  const bb = Buffer.from(right, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verify a local ciphertext matches the digest recorded at land time.
 * Skips when no expected digest is stored (legacy history rows).
 */
export async function assertFileSha256(
  filePath: string,
  expectedHex: string | null | undefined,
  label = 'artifact'
): Promise<void> {
  if (!expectedHex?.trim()) return;
  const actual = await sha256File(filePath);
  if (!timingSafeEqualHex(actual, expectedHex)) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expectedHex.trim().toLowerCase()}, got ${actual}`
    );
  }
}
