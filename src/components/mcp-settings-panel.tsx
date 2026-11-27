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
import {
  useApiTokens,
  type ApiTokenPermission,
  type CreatedApiToken,
} from '@/lib/hooks/useApiTokens'
import { useAuth } from '@/lib/hooks/useAuth'
import { performVaultPasskeyStepUp } from '@/lib/hooks/useEncryption'
import {
  buildClaudeCodeCommand,
  buildClaudeDesktopSnippet,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildVsCodeInstallLink,
} from '@/lib/mcp/install-links'
import { ClipboardIcon, FingerprintIcon, KeyIcon, TrashIcon } from 'lucide-react'
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
  const auth = useAuth()
  const [newName, setNewName] = useState('MCP agent')
  const [allowRemoteExec, setAllowRemoteExec] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [allowAuthorizeKeys, setAllowAuthorizeKeys] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [stepUpToken, setStepUpToken] = useState('')
  const [verifyingPasskey, setVerifyingPasskey] = useState(false)
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  const locked = Boolean(auth.data?.authEnabled)
  const hasPassword = Boolean(auth.data?.hasPassword)
  const hasPasskeys = Boolean(auth.data?.hasPasskeys)
  const stepUpReady =
    !locked ||
    Boolean(stepUpToken) ||
    (hasPassword && currentPassword.length > 0)

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

  const handleVerifyPasskey = async () => {
    setVerifyingPasskey(true)
    try {
      const proof = await performVaultPasskeyStepUp()
      setStepUpToken(proof.stepUpToken ?? '')
      toast.success('Passkey verified — valid for 2 minutes')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Passkey verification failed'
      )
    } finally {
      setVerifyingPasskey(false)
    }
  }

  const handleCreate = async () => {
    try {
      const permissions: ApiTokenPermission[] = readOnly
        ? ['read_only']
        : allowRemoteExec
          ? ['remote_exec']
          : []
      // remote_exec already implies it.
      if (allowAuthorizeKeys && !allowRemoteExec) permissions.push('authorize_keys')
      const result = await tokensQuery.createToken.mutateAsync({
        name: newName.trim() || 'MCP agent',
        permissions,
        ...(locked
          ? {
              currentPassword: currentPassword || undefined,
              stepUpToken: stepUpToken || undefined,
            }
          : {}),
      })
      setCreated(result)
      setNewName('MCP agent')
      setAllowRemoteExec(false)
      setReadOnly(false)
      setAllowAuthorizeKeys(false)
      setCurrentPassword('')
      setStepUpToken('')
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
            instance over MCP at <code className="text-xs">/mcp</code>. Tokens can manage
            backups and servers; remote shell (<code className="text-xs">exec_command</code>)
            and changing pre-backup commands require an explicit permission. A{' '}
            <code className="text-xs">read_only</code> token can inspect and validate but
            cannot mutate (write tools are omitted from the MCP catalog), and cannot run
            ad-hoc connection probes. Prefer HTTPS (or a trusted LAN) when exposing the
            instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!locked && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              Set an app password or passkey before creating API tokens. Unprotected
              instances cannot mint tokens.
            </p>
          )}
          <div className="space-y-3">
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
                disabled={!newName.trim() || !locked || !stepUpReady}
              >
                Create token
              </LoadingButton>
            </div>

            {locked && (
              <div className="max-w-xl space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  Confirm it&apos;s you before minting a token
                </p>
                {hasPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="token-current-password">Current password</Label>
                    <Input
                      id="token-current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value)
                        if (e.target.value) setStepUpToken('')
                      }}
                      placeholder="Required unless you verify a passkey"
                    />
                  </div>
                )}
                {hasPasskeys && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={verifyingPasskey}
                      onClick={() => void handleVerifyPasskey()}
                    >
                      <FingerprintIcon className="mr-2 h-4 w-4" />
                      {verifyingPasskey ? 'Waiting for passkey…' : 'Verify with passkey'}
                    </Button>
                    {stepUpToken && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        Passkey verified (valid for 2 minutes)
                      </span>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  A token is a durable credential: it keeps working until revoked,
                  so a fresh check is required.
                </p>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm max-w-xl cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={readOnly}
                onChange={(e) => {
                  const on = e.target.checked
                  setReadOnly(on)
                  if (on) setAllowRemoteExec(false)
                }}
              />
              <span>
                <span className="font-medium">Read only</span>
                <span className="block text-muted-foreground">
                  Grants <code className="text-xs">read_only</code>: list/get,{' '}
                  <code className="text-xs">validate_backup</code>, and tests of stored
                  endpoints by id. Cannot create, run, or delete backups, and cannot send
                  ad-hoc connection probes. Cannot be combined with remote command
                  execution.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm max-w-xl cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={allowRemoteExec}
                onChange={(e) => {
                  const on = e.target.checked
                  setAllowRemoteExec(on)
                  if (on) setReadOnly(false)
                }}
              />
              <span>
                <span className="font-medium">Allow remote command execution</span>
                <span className="block text-muted-foreground">
                  Grants <code className="text-xs">remote_exec</code>: MCP/API{' '}
                  <code className="text-xs">exec_command</code> on servers, and setting or
                  changing pre-backup commands. Leave off for read/manage-only agents.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm max-w-xl cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={allowAuthorizeKeys || allowRemoteExec}
                disabled={allowRemoteExec}
                onChange={(e) => setAllowAuthorizeKeys(e.target.checked)}
              />
              <span>
                <span className="font-medium">Allow authorizing SSH keys</span>
                <span className="block text-muted-foreground">
                  Grants <code className="text-xs">authorize_keys</code>: the client may add
                  its own public key to a server&apos;s{' '}
                  <code className="text-xs">authorized_keys</code> (for example{' '}
                  <code className="text-xs">sshya link</code>), so it can SSH in without
                  LazyBackup exporting private keys. Works with Read only. That client gets a
                  shell on every server, so treat it like root SSH.
                </span>
              </span>
            </label>
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
                        {token.permissions?.length
                          ? ` · ${token.permissions.join(' · ')}`
                          : ''}
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
