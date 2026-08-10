import { describe, expect, test } from 'bun:test';
import {
  buildAuthorizedKeysEntry,
  buildEphemeralKeyMarker,
  buildRemoveAuthorizedKeysCommand,
  EPHEMERAL_KEY_MARKER_PREFIX,
  stripAuthorizedKeysMarker,
} from '@/lib/ssh/ephemeral';

describe('ephemeral authorized_keys helpers', () => {
  test('builds marker with prefix', () => {
    const marker = buildEphemeralKeyMarker('abc123');
    expect(marker).toBe(`${EPHEMERAL_KEY_MARKER_PREFIX}abc123`);
  });

  test('builds authorized_keys entry with marker comment', () => {
    const entry = buildAuthorizedKeysEntry(
      'lazybackup-ephemeral:test',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey data'
    );
    expect(entry).toContain('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestkey data');
    expect(entry.endsWith('lazybackup-ephemeral:test')).toBe(true);
  });

  test('strips marked lines from authorized_keys content', () => {
    const marker = 'lazybackup-ephemeral:xyz';
    const content = [
      'ssh-ed25519 AAAAkeep keep@host',
      `ssh-ed25519 AAAAtemp ${marker}`,
      'ssh-rsa AAAAalso keep2@host',
      '',
    ].join('\n');

    const cleaned = stripAuthorizedKeysMarker(content, marker);
    expect(cleaned).toContain('AAAAkeep');
    expect(cleaned).toContain('AAAAalso');
    expect(cleaned).not.toContain(marker);
    expect(cleaned).not.toContain('AAAAtemp');
  });

  test('remove command embeds marker safely for sed', () => {
    const cmd = buildRemoveAuthorizedKeysCommand('lazybackup-ephemeral:abc');
    expect(cmd).toContain("sed -i '/lazybackup-ephemeral:abc/d'");
    expect(cmd).toContain('authorized_keys');
  });
});
