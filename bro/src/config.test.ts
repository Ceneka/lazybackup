import { describe, expect, test } from 'bun:test'
import path from 'path'
import { defaultDataDirFor, shouldOpenUiOnStart } from './config'

describe('defaultDataDirFor', () => {
  test('linux uses XDG-style share dir', () => {
    expect(defaultDataDirFor('linux', '/home/sam', {}, () => false)).toBe(
      path.join('/home/sam', '.local', 'share', 'lazybro')
    )
  })

  test('windows uses APPDATA', () => {
    const roaming = path.join('/home/sam', 'AppData', 'Roaming')
    expect(defaultDataDirFor('win32', '/home/sam', { APPDATA: roaming })).toBe(
      path.join(roaming, 'LazyBro')
    )
  })

  test('darwin uses Application Support', () => {
    expect(defaultDataDirFor('darwin', '/Users/sam', {}, () => false)).toBe(
      path.join('/Users/sam', 'Library', 'Application Support', 'LazyBro')
    )
  })

  test('darwin keeps a legacy ~/.local/share/lazybro tree if present', () => {
    const legacy = path.join('/Users/sam', '.local', 'share', 'lazybro')
    expect(
      defaultDataDirFor('darwin', '/Users/sam', {}, (p) => p === legacy)
    ).toBe(legacy)
  })
})

describe('shouldOpenUiOnStart', () => {
  test('interactive run still opens the UI', () => {
    expect(shouldOpenUiOnStart(true, {})).toBe(true)
    expect(shouldOpenUiOnStart(false, {})).toBe(false)
  })

  test('autostart wrappers stay headless', () => {
    expect(shouldOpenUiOnStart(true, { LAZYBRO_AUTOSTART: '1' })).toBe(false)
  })
})
