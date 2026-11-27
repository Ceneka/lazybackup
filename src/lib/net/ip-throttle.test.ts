import { describe, expect, test } from 'bun:test';
import {
  consumeIpRateLimit,
  ipRateLimitBucketCountForTests,
  resetIpRateLimitForTests,
} from './ip-throttle';

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

  test('prunes expired buckets once the map grows under spoofed keys', () => {
    resetIpRateLimitForTests();
    for (let i = 0; i < 6_000; i++) {
      expect(
        consumeIpRateLimit(`spoof-${i}`, { max: 10, windowMs: 1_000, now: 0 })
      ).toBe(true);
    }
    expect(ipRateLimitBucketCountForTests()).toBeGreaterThanOrEqual(6_000);

    consumeIpRateLimit('fresh', { max: 10, windowMs: 1_000, now: 5_000 });
    expect(ipRateLimitBucketCountForTests()).toBe(1);
    resetIpRateLimitForTests();
  });

  test('caps live buckets even when spoofed keys have not expired', () => {
    resetIpRateLimitForTests();
    for (let i = 0; i < 20_000; i++) {
      consumeIpRateLimit(`live-${i}`, { max: 1, windowMs: 600_000, now: 0 });
    }
    expect(ipRateLimitBucketCountForTests()).toBeLessThanOrEqual(10_000);
    resetIpRateLimitForTests();
  });
});
