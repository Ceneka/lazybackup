'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { QueryState } from '@/components/ui/query-state'
import { useApiTokens, type CreatedApiToken } from '@/lib/hooks/useApiTokens'
import {
  buildClaudeCodeCommand,
  buildClaudeDesktopSnippet,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildVsCodeInstallLink,
} from '@/lib/mcp/install-links'
import { ClipboardIcon, KeyIcon, TrashIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

async function copyText(label: string, text: string) {
  await navigator.clipboard.writeText(text)
  toast.success(`${label} copied`)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export function McpSettingsPanel() {
  const tokensQuery = useApiTokens()
  const [newName, setNewName] = useState('MCP agent')
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const install = useMemo(() => {
    if (!created?.token || !origin) return null
    return {
      cursor: buildCursorInstallLink(origin, created.token),
      vscode: buildVsCodeInstallLink(origin, created.token),
      mcpJson: buildMcpJsonSnippet(origin, created.token),
      claude: buildClaudeDesktopSnippet(origin, created.token),
      claudeCode: buildClaudeCodeCommand(origin, created.token),
    }
  }, [created, origin])

  const handleCreate = async () => {
    try {
      const result = await tokensQuery.createToken.mutateAsync(newName.trim() || 'MCP agent')
      setCreated(result)
      setNewName('MCP agent')
    } catch {
      // toast in hook
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API tokens &amp; MCP</CardTitle>
          <CardDescription>
            Create a token so Cursor, Claude, or other agents can manage this LazyBackup
            instance over MCP at <code className="text-xs">/mcp</code>. Tokens have full
            operator access — treat them like the app password. Prefer HTTPS (or a trusted
            LAN) when exposing the instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="token-name">New token name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="token-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="MCP agent"
                className="sm:max-w-xs"
              />
              <LoadingButton
                onClick={handleCreate}
                isLoading={tokensQuery.createToken.isPending}
                disabled={!newName.trim()}
              >
                Create token
              </LoadingButton>
            </div>
          </div>

          {created && install && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-4">
              <div>
                <p className="text-sm font-medium">Token created — copy it now</p>
                <p className="text-sm text-muted-foreground">
                  This plaintext value is shown once. Install links below embed it.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="block flex-1 break-all rounded bg-muted px-3 py-2 text-xs">
                  {created.token}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText('Token', created.token)}
                >
                  <ClipboardIcon className="mr-2 h-4 w-4" />
                  Copy token
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={install.cursor}>Add to Cursor</a>
                </Button>
                <Button variant="secondary" asChild>
                  <a href={install.vscode}>Add to VS Code</a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyText('mcp.json', install.mcpJson)}
                >
                  Copy mcp.json
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyText('Claude config', install.claude)}
                >
                  Copy Claude config
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyText('Claude Code command', install.claudeCode)}
                >
                  Copy Claude Code CLI
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                MCP URL: <code>{origin}/mcp</code> · Authorization:{' '}
                <code>Bearer &lt;token&gt;</code>
              </p>
            </div>
          )}

          <QueryState
            query={tokensQuery}
            dataLabel="API tokens"
            errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
          >
            {tokensQuery.tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active API tokens yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {tokensQuery.tokens.map((token) => (
                  <li
                    key={token.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{token.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {token.tokenPrefix} · created {formatDate(token.createdAt)} · last used{' '}
                        {formatDate(token.lastUsedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={tokensQuery.revokeToken.isPending}
                      onClick={() => {
                        if (
                          !confirm(
                            `Revoke token "${token.name}"? Agents using it will lose access immediately.`
                          )
                        ) {
                          return
                        }
                        void tokensQuery.revokeToken.mutateAsync(token.id).then(() => {
                          if (created?.id === token.id) setCreated(null)
                        })
                      }}
                    >
                      <TrashIcon className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual setup</CardTitle>
          <CardDescription>
            If one-click install is unavailable, paste this into your client&apos;s MCP config
            after creating a token.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`{
  "mcpServers": {
    "lazybackup": {
      "url": "${origin || 'https://your-host'}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
