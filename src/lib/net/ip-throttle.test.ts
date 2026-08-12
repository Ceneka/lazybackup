import { describe, expect, test } from 'bun:test';
import { consumeIpRateLimit, resetIpRateLimitForTests } from './ip-throttle';

describe('consumeIpRateLimit', () => {
  test('allows up to max then denies until the window resets', () => {
    resetIpRateLimitForTests();
    const key = 'test-ip-1';
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(consumeIpRateLimit(key, { max: 10, windowMs: 60_000, now })).toBe(true);
    }
    expect(consumeIpRateLimit(key, { max: 10, windowMs: 60_000, now })).toBe(false);
    expect(consumeIpRateLimit(key, { max: 10, windowMs: 60_000, now: now + 60_000 })).toBe(true);
  });
});
