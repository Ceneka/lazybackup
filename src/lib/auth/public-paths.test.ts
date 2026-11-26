import { describe, expect, test } from 'bun:test'
import { isPublicPath } from './public-paths'

describe('isPublicPath', () => {
  test('allows the documented public endpoints exactly', () => {
    for (const path of [
      '/login',
      '/api/health',
      '/api/auth/status',
      '/api/auth/login',
      '/api/auth/setup',
      '/api/auth/webauthn/login',
      '/api/peers/pair',
      '/manifest.webmanifest',
      '/api/peers/store',
      '/api/peers/store/some/object',
      '/api/peers/agent/ping',
      '/_next/static/chunks/main.js',
      '/favicon.ico',
    ]) {
      expect(isPublicPath(path)).toBe(true)
    }
  })

  test('allows top-level files from public/', () => {
    for (const path of [
      '/logo.svg',
      '/logo.png',
      '/apple-touch-icon.png',
      '/next.svg',
      '/robots.txt',
    ]) {
      expect(isPublicPath(path)).toBe(true)
    }
  })

  test('gates every API and MCP path, even with a static-asset extension', () => {
    for (const path of [
      '/api/backups',
      '/api/backups/',
      '/mcp',
      '/mcp/',
      '/api/backups/abc.png',
      '/api/backups/abc.svg',
      '/api/history/abc.ico',
      '/api/servers/abc.webp',
      '/api/settings/export.png',
      '/api/peers/agent.png',
      '/api/health/../backups',
      '/api/health/',
    ]) {
      expect(isPublicPath(path)).toBe(false)
    }
  })

  test('gates app pages, even with a static-asset extension', () => {
    for (const path of [
      '/',
      '/settings',
      '/backups/abc',
      '/backups/abc.png',
      '/history/abc.svg',
      '/servers/abc.webp',
      '/login/../api/backups',
    ]) {
      expect(isPublicPath(path)).toBe(false)
    }
  })
})
