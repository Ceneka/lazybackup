import { describe, expect, test } from 'bun:test'
import {
  buildClaudeCodeCommand,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildMcpRemoteConfig,
  buildVsCodeInstallLink,
} from './install-links'
import { hashApiToken } from '../auth/api-tokens'

describe('MCP install links', () => {
  const origin = 'https://backup.example.com'
  const token = 'lb_abc123deadbeef'

  test('builds remote config URL and bearer header', () => {
    const config = buildMcpRemoteConfig(origin, token)
    expect(config.url).toBe('https://backup.example.com/mcp')
    expect(config.headers.Authorization).toBe(`Bearer ${token}`)
  })

  test('cursor deeplink embeds base64 config', () => {
    const link = buildCursorInstallLink(origin, token)
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true)
    expect(link).toContain('name=lazybackup')
    expect(link).toContain('config=')
  })

  test('vscode install link is encoded', () => {
    const link = buildVsCodeInstallLink(origin, token)
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
  })

  test('mcp.json snippet includes server entry', () => {
    const json = buildMcpJsonSnippet(origin, token)
    const parsed = JSON.parse(json)
    expect(parsed.mcpServers.lazybackup.url).toBe('https://backup.example.com/mcp')
  })

  test('claude code command includes transport http and header', () => {
    const cmd = buildClaudeCodeCommand(origin, token)
    expect(cmd).toContain('--transport http')
    expect(cmd).toContain(token)
    expect(cmd).toContain('https://backup.example.com/mcp')
  })
})

describe('API token hashing', () => {
  test('hashApiToken is stable and hex', () => {
    const a = hashApiToken('lb_test')
    const b = hashApiToken('lb_test')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
