import { describe, expect, test } from 'bun:test';
import {
  ResourceInUseError,
  isResourceInUseError,
  resourceInUseFromResponse,
} from './resource-in-use';

describe('resourceInUseFromResponse', () => {
  test('builds error from backups payload', () => {
    const err = resourceInUseFromResponse(
      409,
      {
        error: 'Server is used by backup configurations',
        backups: [{ id: 'b1', name: 'Nightly' }],
      },
      'Server is used by backups'
    );
    expect(err).toBeInstanceOf(ResourceInUseError);
    expect(err?.resources).toEqual([{ id: 'b1', name: 'Nightly' }]);
    expect(err?.message).toContain('Nightly');
  });

  test('builds error from servers payload', () => {
    const err = resourceInUseFromResponse(
      409,
      { servers: [{ id: 's1', name: 'Prod' }] },
      'SSH key is used by servers'
    );
    expect(err?.resources[0].name).toBe('Prod');
    expect(isResourceInUseError(err)).toBe(true);
  });

  test('returns null for other statuses', () => {
    expect(
      resourceInUseFromResponse(500, { error: 'nope' }, 'fallback')
    ).toBeNull();
  });
});
