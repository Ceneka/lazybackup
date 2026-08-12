import { describe, expect, test } from 'bun:test';
import {
  hasRestoreConfirm,
  restoreHistorySchema,
} from './history-schema';

describe('restoreHistorySchema', () => {
  test('requires confirm=true', () => {
    expect(hasRestoreConfirm({})).toBe(false);
    expect(hasRestoreConfirm({ confirm: false })).toBe(false);
    expect(hasRestoreConfirm({ confirm: true })).toBe(true);
    expect(() => restoreHistorySchema.parse({})).toThrow();
    expect(() => restoreHistorySchema.parse({ confirm: false })).toThrow();
    expect(restoreHistorySchema.parse({ confirm: true })).toEqual({
      confirm: true,
    });
  });

  test('accepts optional restore targets with confirm', () => {
    expect(
      restoreHistorySchema.parse({
        confirm: true,
        volumeName: 'data',
        databaseName: 'app',
        allowRetarget: true,
      })
    ).toEqual({
      confirm: true,
      volumeName: 'data',
      databaseName: 'app',
      allowRetarget: true,
    });
  });
});
