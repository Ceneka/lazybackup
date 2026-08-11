/**
 * Build MCP remote config + one-click install links for Cursor / VS Code / Claude.
 */

export type McpRemoteConfig = {
  url: string
  headers: {
    Authorization: string
  }
}

export function buildMcpRemoteConfig(origin: string, token: string): McpRemoteConfig {
  const base = origin.replace(/\/$/, '')
  return {
    url: `${base}/mcp`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
}

export function buildMcpJsonSnippet(origin: string, token: string, name = 'lazybackup'): string {
  const config = buildMcpRemoteConfig(origin, token)
  return JSON.stringify(
    {
      mcpServers: {
        [name]: config,
      },
    },
    null,
    2
  )
}

/** Cursor deeplink: cursor://anysphere.cursor-deeplink/mcp/install?name=&config=base64 */
export function buildCursorInstallLink(origin: string, token: string, name = 'lazybackup'): string {
  const config = buildMcpRemoteConfig(origin, token)
  const encoded =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(JSON.stringify(config))))
      : Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encoded)}`
}

/** VS Code MCP install deeplink (URL-encoded JSON config) */
export function buildVsCodeInstallLink(origin: string, token: string, name = 'lazybackup'): string {
  const config = {
    name,
    ...buildMcpRemoteConfig(origin, token),
  }
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`
}

export function buildClaudeDesktopSnippet(origin: string, token: string, name = 'lazybackup'): string {
  return buildMcpJsonSnippet(origin, token, name)
}

/** Claude Code CLI to add a remote HTTP MCP server */
export function buildClaudeCodeCommand(origin: string, token: string, name = 'lazybackup'): string {
  const { url } = buildMcpRemoteConfig(origin, token)
  return `claude mcp add --transport http ${name} ${url} --header "Authorization: Bearer ${token}"`
}
