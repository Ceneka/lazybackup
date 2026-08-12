import { describe, expect, test } from 'bun:test';
import {
  findKnownHost,
  formatKnownHostsLine,
  knownHostsHostField,
  parseKnownHosts,
  parseSshPublicKeyBuffer,
  verifyOrPinHostKey,
} from './known-hosts';

/** Minimal ssh-ed25519 public key blob (length-prefixed type + dummy body). */
function fakeEd25519Key(seed = 1): Buffer {
  const type = Buffer.from('ssh-ed25519');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(type.length, 0);
  const body = Buffer.alloc(32, seed);
  const bodyLen = Buffer.alloc(4);
  bodyLen.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, type, bodyLen, body]);
}

describe('known hosts helpers', () => {
  test('formats non-22 ports with brackets', () => {
    expect(knownHostsHostField('example.com', 22)).toBe('example.com');
    expect(knownHostsHostField('example.com', 2222)).toBe('[example.com]:2222');
  });

  test('parses SSH public key wire format', () => {
    const key = fakeEd25519Key();
    const parsed = parseSshPublicKeyBuffer(key);
    expect(parsed.type).toBe('ssh-ed25519');
    expect(parsed.base64).toBe(key.toString('base64'));
  });

  test('TOFU pins unknown host then accepts the same key', () => {
    const key = fakeEd25519Key(7);
    const first = verifyOrPinHostKey('', 'box.example', 22, key);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.pinned).toBe(true);
    expect(first.nextContent).toContain('box.example');

    const second = verifyOrPinHostKey(first.nextContent || '', 'box.example', 22, key);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.pinned).toBe(false);
  });

  test('fails closed on host key mismatch', () => {
    const a = fakeEd25519Key(1);
    const b = fakeEd25519Key(2);
    const pinned = verifyOrPinHostKey('', 'box.example', 22, a);
    expect(pinned.ok).toBe(true);
    const mismatch = verifyOrPinHostKey(pinned.nextContent || '', 'box.example', 22, b);
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.reason).toMatch(/mismatch/i);
  });

  test('parseKnownHosts skips comments', () => {
    const key = fakeEd25519Key();
    const line = formatKnownHostsLine('h', 22, key);
    const entries = parseKnownHosts(`# comment\n${line}\n`);
    expect(findKnownHost(entries, 'h', 22)?.base64).toBe(parseSshPublicKeyBuffer(key).base64);
  });
});
