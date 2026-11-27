import { describe, expect, test } from 'bun:test';
import {
  classifyControlResponse,
  classifyTransportFailure,
  summarizeItemErrors,
} from './sync';

describe('LazyBro error classification', () => {
  test('401/403 means the friend removed the connection, not offline', () => {
    for (const status of [401, 403]) {
      const result = classifyControlResponse('ping', status);
      expect(result.authRevoked).toBe(true);
      expect(result.hostReachable).toBe(true);
      expect(result.needsAttention).toBe(false);
      expect(result.lastError).toMatch(/removed this connection/i);
    }
  });

  test('5xx marks the host unreachable (retryable connectivity)', () => {
    const result = classifyControlResponse('work', 503);
    expect(result.hostReachable).toBe(false);
    expect(result.authRevoked).toBe(false);
    expect(result.needsAttention).toBe(false);
    expect(result.lastError).toContain('503');
  });

  test('other 4xx stays reachable and needs attention', () => {
    const result = classifyControlResponse('ping', 429);
    expect(result.hostReachable).toBe(true);
    expect(result.authRevoked).toBe(false);
    expect(result.needsAttention).toBe(true);
  });

  test('transport failures are unreachable, not auth problems', () => {
    const result = classifyTransportFailure(
      'ping',
      new Error('Remote request timed out after 30000ms')
    );
    expect(result.hostReachable).toBe(false);
    expect(result.authRevoked).toBe(false);
    expect(result.needsAttention).toBe(false);
    expect(result.lastError).toContain('timed out');
  });

  test('per-item failures need attention but keep the host reachable', () => {
    const summary = summarizeItemErrors([
      'Pull backups/a.age: Quota exceeded: need 10 bytes, used 90 of 100',
      'ACK backups/b.age: HTTP 409',
    ]);
    expect(summary.needsAttention).toBe(true);
    expect(summary.lastError).toContain('Quota exceeded');
    expect(summary.lastError).toContain('HTTP 409');
  });

  test('no item errors clears attention', () => {
    expect(summarizeItemErrors([])).toEqual({
      needsAttention: false,
      lastError: null,
    });
  });
});
