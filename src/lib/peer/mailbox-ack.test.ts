import { describe, expect, test } from 'bun:test';
import { sha256Buffer } from './digest';
import { decideMailboxAck } from './mailbox-ack';

const stagedSha256 = sha256Buffer(Buffer.from('staged-ciphertext'));

describe('decideMailboxAck', () => {
  test('keeps staging when ACK omits sha256 (old bro)', () => {
    const decision = decideMailboxAck({
      claimed: { key: 'obj.age', size: 18 },
      stagedSize: 18,
      stagedSha256,
    });
    expect(decision).toEqual({ action: 'keep', reason: 'missing_receipt' });
  });

  test('keeps staging when sha256 mismatches', () => {
    const decision = decideMailboxAck({
      claimed: { key: 'obj.age', size: 18, sha256: sha256Buffer(Buffer.from('other')) },
      stagedSize: 18,
      stagedSha256,
    });
    expect(decision).toEqual({ action: 'keep', reason: 'mismatch' });
  });

  test('keeps staging when size mismatches even if hash matches', () => {
    const decision = decideMailboxAck({
      claimed: { key: 'obj.age', size: 99, sha256: stagedSha256 },
      stagedSize: 18,
      stagedSha256,
    });
    expect(decision).toEqual({ action: 'keep', reason: 'mismatch' });
  });

  test('accepts matching sha256 and size', () => {
    const decision = decideMailboxAck({
      claimed: { key: 'obj.age', size: 18, sha256: stagedSha256 },
      stagedSize: 18,
      stagedSha256,
    });
    expect(decision).toEqual({ action: 'accept' });
  });
});
