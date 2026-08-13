import { describe, expect, test } from 'bun:test';
import { mailboxDeletesToApply } from './sync';

describe('mailboxDeletesToApply', () => {
  test('skips a key that has an in-flight recall', () => {
    expect(
      mailboxDeletesToApply(
        [{ key: 'keep.age' }, { key: 'busy.age' }],
        ['busy.age']
      )
    ).toEqual([{ key: 'keep.age' }]);
  });

  test('returns empty for missing deletes', () => {
    expect(mailboxDeletesToApply(undefined, ['a.age'])).toEqual([]);
  });
});
