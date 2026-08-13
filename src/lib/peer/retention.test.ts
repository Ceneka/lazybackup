import { describe, expect, test } from 'bun:test';
import { advertiseMailboxDeletes, parsePeerArtifactPath } from './retention';

describe('advertiseMailboxDeletes', () => {
  test('skips keys with an open recall', () => {
    expect(
      advertiseMailboxDeletes(
        ['keep.age', 'busy.age', 'also.age'],
        new Set(['busy.age'])
      )
    ).toEqual([{ key: 'keep.age' }, { key: 'also.age' }]);
  });

  test('returns all keys when no recalls are open', () => {
    expect(advertiseMailboxDeletes(['a.age', 'b.age'], [])).toEqual([
      { key: 'a.age' },
      { key: 'b.age' },
    ]);
  });
});

describe('parsePeerArtifactPath', () => {
  test('parses peer://peerId/key', () => {
    expect(parsePeerArtifactPath('peer://abc/db/obj.sql.gz.age')).toEqual({
      peerId: 'abc',
      objectKey: 'db/obj.sql.gz.age',
    });
  });

  test('rejects traversal keys', () => {
    expect(parsePeerArtifactPath('peer://abc/../secret')).toBeNull();
  });
});
