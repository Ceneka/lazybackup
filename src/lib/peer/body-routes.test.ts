import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import { pathToRegexp } from 'next/dist/compiled/path-to-regexp';
import { MIDDLEWARE_MATCHER, PEER_BODY_ROUTE_PREFIXES } from './body-routes';

/**
 * Regression: large peer uploads (mailbox recall / direct store PUT) must
 * bypass the middleware body clone. Otherwise Next truncates bodies at the
 * 10 MiB `middlewareClientMaxBodySize` default and races request.body reads.
 */
describe('peer body routes bypass middleware', () => {
  const matcher = pathToRegexp(MIDDLEWARE_MATCHER);

  test('peer store and agent routes are not matched', () => {
    for (const prefix of PEER_BODY_ROUTE_PREFIXES) {
      expect(matcher.test(`/${prefix}/nested/path`)).toBe(false);
    }
    expect(matcher.test('/api/peers/store')).toBe(false);
    expect(matcher.test('/api/peers/agent/recall/abc')).toBe(false);
  });

  test('middleware.ts uses the same literal matcher', () => {
    const source = readFileSync(path.join(import.meta.dir, '../../middleware.ts'), 'utf8');
    expect(source).toContain(`'${MIDDLEWARE_MATCHER}'`);
  });

  test('the rest of the app still goes through middleware', () => {
    expect(matcher.test('/api/peers/storage-admin')).toBe(true);
    expect(matcher.test('/api/peers/agents')).toBe(true);
    expect(matcher.test('/api/peers')).toBe(true);
    expect(matcher.test('/api/peers/pair')).toBe(true);
    expect(matcher.test('/api/backups')).toBe(true);
    expect(matcher.test('/dashboard')).toBe(true);
  });
});
