import { describe, expect, test } from 'bun:test';
import { validateTarMembers } from './archive-safety';

describe('validateTarMembers', () => {
  test('accepts ordinary members and internal symlinks/hardlinks', () => {
    expect(() =>
      validateTarMembers([
        { type: 'd', name: 'app/' },
        { type: '-', name: 'app/data.txt' },
        { type: 'l', name: 'app/current', linkTarget: 'data.txt' },
        { type: 'h', name: 'app/copy.txt', linkTarget: 'app/data.txt' },
      ])
    ).not.toThrow();
  });

  test('rejects absolute and traversal member names', () => {
    expect(() => validateTarMembers([{ type: '-', name: '/etc/passwd' }])).toThrow(/absolute/i);
    expect(() => validateTarMembers([{ type: '-', name: '../outside' }])).toThrow(/traversal/i);
  });

  test('rejects escaping symlink targets', () => {
    expect(() =>
      validateTarMembers([
        { type: 'd', name: 'app/' },
        { type: 'l', name: 'app/link', linkTarget: '../../outside' },
      ])
    ).toThrow(/symlink|traversal/i);
    expect(() =>
      validateTarMembers([{ type: 'l', name: 'link', linkTarget: '/etc/passwd' }])
    ).toThrow(/absolute/i);
  });

  test('rejects escaping or absent hardlink targets', () => {
    expect(() =>
      validateTarMembers([{ type: 'h', name: 'copy', linkTarget: '../outside' }])
    ).toThrow(/hardlink|traversal/i);
    expect(() =>
      validateTarMembers([{ type: 'h', name: 'copy', linkTarget: 'missing' }])
    ).toThrow(/not in archive/i);
  });
});
