import { describe, expect, test } from 'bun:test';
import { findServersUsingSshKey } from './key-usage';

describe('findServersUsingSshKey', () => {
  const servers = [
    { id: 's1', name: 'Prod', sshKeyId: 'key-a' },
    { id: 's2', name: 'Staging', sshKeyId: 'key-b' },
    { id: 's3', name: 'Also Prod', sshKeyId: 'key-a' },
    { id: 's4', name: 'Password only', sshKeyId: null },
  ];

  test('returns servers that reference the key', () => {
    expect(findServersUsingSshKey(servers, 'key-a')).toEqual([
      { id: 's1', name: 'Prod' },
      { id: 's3', name: 'Also Prod' },
    ]);
  });

  test('returns empty when unused', () => {
    expect(findServersUsingSshKey(servers, 'key-missing')).toEqual([]);
  });
});
