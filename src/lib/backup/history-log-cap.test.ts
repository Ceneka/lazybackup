import { describe, expect, test } from 'bun:test';
import { capLogOutput, deliveryErrorForHistoryRow, LOG_OUTPUT_MAX_CHARS } from './history';

describe('log output cap', () => {
  test('leaves small logs untouched', () => {
    expect(capLogOutput('rsync: ok\n')).toBe('rsync: ok\n');
    expect(capLogOutput('')).toBe('');
    expect(capLogOutput(undefined)).toBeUndefined();
    expect(capLogOutput(null)).toBeNull();
  });

  test('leaves a log exactly at the limit untouched', () => {
    const atLimit = 'x'.repeat(LOG_OUTPUT_MAX_CHARS);
    expect(capLogOutput(atLimit)).toBe(atLimit);
  });

  test('keeps the tail and prefixes the truncation marker', () => {
    const head = 'a'.repeat(1_000);
    const tail = 'rsync error: some files could not be transferred';
    const big = `${head}${'b'.repeat(LOG_OUTPUT_MAX_CHARS)}${tail}`;

    const capped = capLogOutput(big);

    expect(capped).toStartWith(
      `…[truncated ${big.length - LOG_OUTPUT_MAX_CHARS} characters]\n`
    );
    // Errors live at the end: the whole tail must survive.
    expect(capped?.endsWith(tail)).toBe(true);
    // The beginning was dropped rather than kept.
    expect(capped).not.toContain(head.slice(0, 100));
    expect(capped!.length).toBeLessThan(big.length);
  });

  test('does not start the stored tail in the middle of a surrogate pair', () => {
    const big = `😀${'b'.repeat(LOG_OUTPUT_MAX_CHARS)}`;
    const capped = capLogOutput(big);
    expect(capped).not.toContain('\ufffd');
    expect(capped?.endsWith('b'.repeat(LOG_OUTPUT_MAX_CHARS))).toBe(true);
  });
});

describe('deliveryErrorForHistoryRow', () => {
  const row = {
    artifactPath: 'peer://peer_bro/backups/a.age',
    backupConfig: {
      destinationPeer: { remoteLastError: 'Pull backups/a.age: Quota exceeded' },
    },
  };

  test('returns the persisted reason only for a failed delivery', () => {
    expect(
      deliveryErrorForHistoryRow({ ...row, deliveryError: '  quota exceeded  ' }, 'failed')
    ).toBe('quota exceeded');
    expect(
      deliveryErrorForHistoryRow({ ...row, deliveryError: 'quota exceeded' }, 'stored')
    ).toBeNull();
    expect(deliveryErrorForHistoryRow({ ...row, deliveryError: 'stale' }, 'waiting')).toBeNull();
  });

  test('falls back to the peer report naming this object', () => {
    expect(deliveryErrorForHistoryRow(row, 'failed')).toBe(
      'Pull backups/a.age: Quota exceeded'
    );
    expect(
      deliveryErrorForHistoryRow(
        {
          ...row,
          backupConfig: {
            destinationPeer: { remoteLastError: 'Pull backups/other.age: HTTP 500' },
          },
        },
        'failed'
      )
    ).toBeNull();
  });
});
