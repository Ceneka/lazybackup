import { describe, expect, test } from 'bun:test'
import {
  REMOTE_EXEC_DENIED,
  RemoteExecPermissionError,
  assertCanSetPreBackupCommands,
  authAllowsRemoteExec,
  authAllowsWrite,
  authHasPermission,
  isReadOnlyApiException,
  normalizeApiTokenPermissionsInput,
  parseApiTokenPermissions,
  preBackupChangeRequiresRemoteExec,
  serializeApiTokenPermissions,
} from './permissions'

describe('parseApiTokenPermissions', () => {
  test('parses valid JSON array', () => {
    expect(parseApiTokenPermissions('["remote_exec"]')).toEqual(['remote_exec'])
    expect(parseApiTokenPermissions('["read_only"]')).toEqual(['read_only'])
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
    expect(normalizeApiTokenPermissionsInput(['read_only'])).toEqual(['read_only'])
    expect(normalizeApiTokenPermissionsInput([])).toEqual([])
  })

  test('normalize rejects read_only combined with remote_exec', () => {
    expect(() =>
      normalizeApiTokenPermissionsInput(['read_only', 'remote_exec'])
    ).toThrow(/cannot be combined/)
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

describe('authAllowsWrite', () => {
  test('session and unlocked always write', () => {
    expect(authAllowsWrite({ authorized: true, via: 'session' })).toBe(true)
    expect(authAllowsWrite({ authorized: true, via: 'unlocked' })).toBe(true)
  })

  test('unauthorized never writes', () => {
    expect(authAllowsWrite({ authorized: false, via: 'none' })).toBe(false)
    expect(authAllowsWrite({ authorized: false, via: 'bearer' })).toBe(false)
  })

  test('bearer without read_only still writes (existing tokens)', () => {
    expect(
      authAllowsWrite({
        authorized: true,
        via: 'bearer',
        apiToken: { permissions: [] },
      })
    ).toBe(true)
    expect(
      authAllowsWrite({
        authorized: true,
        via: 'bearer',
        apiToken: { permissions: ['remote_exec'] },
      })
    ).toBe(true)
  })

  test('bearer with read_only cannot write', () => {
    expect(
      authAllowsWrite({
        authorized: true,
        via: 'bearer',
        apiToken: { permissions: ['read_only'] },
      })
    ).toBe(false)
  })

  test('session with hypothetical read_only still writes', () => {
    expect(
      authAllowsWrite({
        authorized: true,
        via: 'session',
        apiToken: { permissions: ['read_only'] },
      })
    ).toBe(true)
  })
})

describe('isReadOnlyApiException', () => {
  test('allows GET and /mcp', () => {
    expect(isReadOnlyApiException('GET', '/api/status')).toBe(true)
    expect(isReadOnlyApiException('HEAD', '/api/backups')).toBe(true)
    expect(isReadOnlyApiException('POST', '/mcp')).toBe(true)
    expect(isReadOnlyApiException('DELETE', '/mcp')).toBe(true)
  })

  test('allows validate and test probes', () => {
    expect(isReadOnlyApiException('POST', '/api/backups/abc/validate')).toBe(true)
    expect(isReadOnlyApiException('POST', '/api/backups/database/test')).toBe(true)
    expect(isReadOnlyApiException('POST', '/api/servers/test')).toBe(true)
    expect(isReadOnlyApiException('POST', '/api/servers/abc/test')).toBe(true)
    expect(isReadOnlyApiException('POST', '/api/s3-profiles/test')).toBe(true)
    expect(isReadOnlyApiException('POST', '/api/s3-profiles/abc/test')).toBe(true)
  })

  test('blocks mutating REST', () => {
    expect(isReadOnlyApiException('POST', '/api/backups')).toBe(false)
    expect(isReadOnlyApiException('POST', '/api/backups/abc/run')).toBe(false)
    expect(isReadOnlyApiException('DELETE', '/api/servers/abc')).toBe(false)
    expect(isReadOnlyApiException('PATCH', '/api/settings')).toBe(false)
  })
})
