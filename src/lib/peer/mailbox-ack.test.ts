import { describe, expect, test } from 'bun:test';
import { sha256Buffer } from './digest';
import { decideMailboxAck, decideMailboxDeleteAck } from './mailbox-ack';

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

describe('decideMailboxDeleteAck', () => {
  test('keeps pending delete when ACK omits exists=false', () => {
    expect(decideMailboxDeleteAck({ key: 'obj.age', size: 0 })).toEqual({
      action: 'keep',
      reason: 'missing_proof',
    });
  });

  test('keeps pending delete when size is still non-zero', () => {
    expect(decideMailboxDeleteAck({ key: 'obj.age', exists: false, size: 12 })).toEqual({
      action: 'keep',
      reason: 'still_exists',
    });
  });

  test('accepts exists=false and size 0', () => {
    expect(decideMailboxDeleteAck({ key: 'obj.age', exists: false, size: 0 })).toEqual({
      action: 'accept',
    });
  });

  test('accepts exists=false without size', () => {
    expect(decideMailboxDeleteAck({ key: 'obj.age', exists: false })).toEqual({
      action: 'accept',
    });
  });
});
