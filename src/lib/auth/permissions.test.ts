import { describe, expect, test } from 'bun:test'
import {
  REMOTE_EXEC_DENIED,
  RemoteExecPermissionError,
  assertCanSetPreBackupCommands,
  authAllowsRemoteExec,
  authHasPermission,
  normalizeApiTokenPermissionsInput,
  parseApiTokenPermissions,
  preBackupChangeRequiresRemoteExec,
  serializeApiTokenPermissions,
} from './permissions'

describe('parseApiTokenPermissions', () => {
  test('parses valid JSON array', () => {
    expect(parseApiTokenPermissions('["remote_exec"]')).toEqual(['remote_exec'])
  })

  test('ignores unknown and duplicates', () => {
    expect(parseApiTokenPermissions('["remote_exec","nope","remote_exec"]')).toEqual([
      'remote_exec',
    ])
  })

  test('empty / invalid → []', () => {
    expect(parseApiTokenPermissions(null)).toEqual([])
    expect(parseApiTokenPermissions('')).toEqual([])
    expect(parseApiTokenPermissions('{')).toEqual([])
    expect(parseApiTokenPermissions('"remote_exec"')).toEqual([])
  })
})

describe('serialize / normalize', () => {
  test('serialize round-trips', () => {
    expect(serializeApiTokenPermissions(['remote_exec'])).toBe('["remote_exec"]')
    expect(serializeApiTokenPermissions([])).toBe('[]')
  })

  test('normalize rejects unknown', () => {
    expect(() => normalizeApiTokenPermissionsInput(['remote_exec', 'admin'])).toThrow(
      /Unknown permission/
    )
    expect(normalizeApiTokenPermissionsInput(['remote_exec'])).toEqual(['remote_exec'])
  })
})

describe('authHasPermission / remote_exec', () => {
  test('session and unlocked always allow', () => {
    expect(
      authAllowsRemoteExec({ authorized: true, via: 'session' })
    ).toBe(true)
    expect(
      authAllowsRemoteExec({ authorized: true, via: 'unlocked' })
    ).toBe(true)
  })

  test('bearer requires permission', () => {
    expect(
      authAllowsRemoteExec({
        authorized: true,
        via: 'bearer',
        apiToken: { permissions: [] },
      })
    ).toBe(false)
    expect(
      authHasPermission(
        {
          authorized: true,
          via: 'bearer',
          apiToken: { permissions: ['remote_exec'] },
        },
        'remote_exec'
      )
    ).toBe(true)
  })

  test('unauthorized never allows', () => {
    expect(authAllowsRemoteExec({ authorized: false, via: 'none' })).toBe(false)
  })
})

describe('preBackupChangeRequiresRemoteExec', () => {
  test('empty / clear does not require', () => {
    expect(preBackupChangeRequiresRemoteExec('', 'echo hi')).toBe(false)
    expect(preBackupChangeRequiresRemoteExec(undefined, null)).toBe(false)
  })

  test('unchanged does not require', () => {
    expect(preBackupChangeRequiresRemoteExec('echo hi', 'echo hi')).toBe(false)
    expect(preBackupChangeRequiresRemoteExec('  echo hi\n', 'echo hi')).toBe(false)
  })

  test('set or change requires', () => {
    expect(preBackupChangeRequiresRemoteExec('echo hi', null)).toBe(true)
    expect(preBackupChangeRequiresRemoteExec('echo bye', 'echo hi')).toBe(true)
  })
})

describe('assertCanSetPreBackupCommands', () => {
  test('throws RemoteExecPermissionError for bearer without permission', () => {
    expect(() =>
      assertCanSetPreBackupCommands(
        { authorized: true, via: 'bearer', apiToken: { permissions: [] } },
        'rm -rf /'
      )
    ).toThrow(RemoteExecPermissionError)
    try {
      assertCanSetPreBackupCommands(
        { authorized: true, via: 'bearer', apiToken: { permissions: [] } },
        'rm -rf /'
      )
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteExecPermissionError)
      expect((error as Error).message).toBe(REMOTE_EXEC_DENIED)
    }
  })

  test('allows when remote_exec present', () => {
    expect(() =>
      assertCanSetPreBackupCommands(
        {
          authorized: true,
          via: 'bearer',
          apiToken: { permissions: ['remote_exec'] },
        },
        'echo ok'
      )
    ).not.toThrow()
  })
})
