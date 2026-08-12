import { describe, expect, test } from 'bun:test'
import { safeInternalPath } from './redirect'

describe('safeInternalPath', () => {
  test('allows same-origin relative paths', () => {
    expect(safeInternalPath('/')).toBe('/')
    expect(safeInternalPath('/backups')).toBe('/backups')
    expect(safeInternalPath('/backups?tab=1')).toBe('/backups?tab=1')
  })

  test('rejects protocol-relative and non-relative values', () => {
    expect(safeInternalPath('//evil.example')).toBe('/')
    expect(safeInternalPath('https://evil.example')).toBe('/')
    expect(safeInternalPath('evil.example')).toBe('/')
    expect(safeInternalPath(null)).toBe('/')
  })

  test('rejects backslashes and encoded slashes', () => {
    expect(safeInternalPath('/\\evil.example')).toBe('/')
    expect(safeInternalPath('/foo\\bar')).toBe('/')
    expect(safeInternalPath('/%2fevil.example')).toBe('/')
    expect(safeInternalPath('/%2F%2Fevil.example')).toBe('/')
    expect(safeInternalPath('/%5cevil')).toBe('/')
  })
})
