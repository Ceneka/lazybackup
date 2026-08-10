import { describe, expect, test } from 'bun:test';
import { createHistorySchema, updateHistorySchema } from './history-schema';

describe('createHistorySchema', () => {
  test('requires configId and status', () => {
    expect(() => createHistorySchema.parse({})).toThrow();
    expect(
      createHistorySchema.parse({ configId: 'c1', status: 'running' })
    ).toMatchObject({ configId: 'c1', status: 'running' });
  });

  test('rejects unknown fields', () => {
    expect(() =>
      createHistorySchema.parse({
        configId: 'c1',
        status: 'success',
        evil: true,
      })
    ).toThrow();
  });

  test('coerces startTime strings', () => {
    const parsed = createHistorySchema.parse({
      configId: 'c1',
      status: 'failed',
      startTime: '2026-08-10T00:00:00.000Z',
    });
    expect(parsed.startTime).toBeInstanceOf(Date);
  });
});

describe('updateHistorySchema', () => {
  test('requires at least one field', () => {
    expect(() => updateHistorySchema.parse({})).toThrow();
  });

  test('allows partial status update', () => {
    expect(updateHistorySchema.parse({ status: 'failed' })).toEqual({
      status: 'failed',
    });
  });

  test('rejects configId mutation and unknown keys', () => {
    expect(() =>
      updateHistorySchema.parse({ configId: 'other' })
    ).toThrow();
    expect(() => updateHistorySchema.parse({ nope: 1 })).toThrow();
  });
});
