import { describe, expect, test } from 'bun:test';
import path from 'path';
import { resolveSqliteFilePath } from './instance-export';

describe('resolveSqliteFilePath', () => {
  test('parses file: relative URL', () => {
    const resolved = resolveSqliteFilePath('file:./data.db');
    expect(resolved).toBe(path.resolve('./data.db'));
  });

  test('parses file:/// absolute URL', () => {
    expect(resolveSqliteFilePath('file:///tmp/lb.db')).toBe('/tmp/lb.db');
  });

  test('parses bare path', () => {
    expect(resolveSqliteFilePath('/var/lib/lazybackup/data.db')).toBe(
      '/var/lib/lazybackup/data.db'
    );
  });
});
