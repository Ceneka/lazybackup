"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { copyText } from "@/components/settings/copy-button"
import { useSecretReveal } from "@/components/settings/secret-reveal"
import {
  useApiTokens,
  type ApiTokenPermission,
  type CreatedApiToken,
} from "@/lib/hooks/useApiTokens"
import { useAuth } from "@/lib/hooks/useAuth"
import { performVaultPasskeyStepUp } from "@/lib/hooks/useEncryption"
import {
  buildClaudeCodeCommand,
  buildClaudeDesktopSnippet,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildVsCodeInstallLink,
} from "@/lib/mcp/install-links"
import { cn } from "@/lib/utils"
import { FingerprintIcon, KeyIcon, TrashIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type TokenAccess = "read_only" | "read_write" | "shell"

const ACCESS_OPTIONS: Array<{
  value: TokenAccess
  label: string
  description: string
  permissions: ApiTokenPermission[]
}> = [
  {
    value: "read_only",
    label: "Read only",
    description:
      "Inspect status and configuration, validate backups, and test connections. Cannot change anything.",
    permissions: ["read_only"],
  },
  {
    value: "read_write",
    label: "Read & write",
    description:
      "Create, edit, run, and delete backups, servers, and connections. No remote shell.",
    permissions: [],
  },
  {
    value: "shell",
    label: "Read, write & shell",
    description:
      "Everything in Read & write, plus exec_command and pre-backup commands. Equivalent to root SSH on your servers.",
    permissions: ["remote_exec"],
  },
]

const PERMISSION_BADGES: Record<
  ApiTokenPermission,
  { label: string; variant: "info" | "warning"; description: string }
> = {
  read_only: {
    label: "Read only",
    variant: "info",
    description: "Can read and validate, but not create, run, or delete anything.",
  },
  remote_exec: {
    label: "Remote shell",
    variant: "warning",
    description:
      "Can run shell commands on servers (exec_command) and set pre-backup commands.",
  },
  authorize_keys: {
    label: "Authorize SSH keys",
    variant: "warning",
    description:
      "Can add its own public key to a server’s authorized_keys — effectively shell access.",
  },
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
  const { reveal, dismiss, available: secretBannerAvailable } = useSecretReveal()
  const auth = useAuth()
  const [newName, setNewName] = useState("")
  const [access, setAccess] = useState<TokenAccess | null>(null)
  const [allowAuthorizeKeys, setAllowAuthorizeKeys] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [stepUpToken, setStepUpToken] = useState("")
  const [verifyingPasskey, setVerifyingPasskey] = useState(false)
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [origin, setOrigin] = useState("")

  const locked = Boolean(auth.data?.authEnabled)
  const hasPassword = Boolean(auth.data?.hasPassword)
  const hasPasskeys = Boolean(auth.data?.hasPasskeys)
  const stepUpReady =
    !locked ||
    Boolean(stepUpToken) ||
    (hasPassword && currentPassword.length > 0)

  const handleVerifyPasskey = async () => {
    setVerifyingPasskey(true)
    try {
      const proof = await performVaultPasskeyStepUp()
      setStepUpToken(proof.stepUpToken ?? "")
      toast.success("Passkey verified — valid for 2 minutes")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Passkey verification failed"
      )
    } finally {
      setVerifyingPasskey(false)
    }
  }

  // Read the origin after mount so the server and first client render match.
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

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
    if (!access) return
    try {
      const permissions = [...ACCESS_OPTIONS.find((o) => o.value === access)!.permissions]
      // remote_exec already implies authorize_keys on the server.
      if (allowAuthorizeKeys && access !== "shell") permissions.push("authorize_keys")
      const result = await tokensQuery.createToken.mutateAsync({
        name: newName.trim() || "MCP agent",
        permissions,
        ...(locked
          ? {
              currentPassword: currentPassword || undefined,
              stepUpToken: stepUpToken || undefined,
            }
          : {}),
      })
      setCreated(result)
      if (secretBannerAvailable) {
        reveal({
          id: `api-token:${result.id}`,
          title: "New API token",
          description:
            "Copy this token into your MCP client now. It is shown only once — you can’t retrieve it later.",
          value: result.token,
          copyLabel: "Token",
          extra: (
            <p className="text-sm">
              MCP URL: <code className="text-xs">{origin || "https://your-host"}/mcp</code>{" "}
              · Authorization: <code className="text-xs">Bearer &lt;token&gt;</code>
            </p>
          ),
        })
      }
      setNewName("")
      setAccess(null)
      setAllowAuthorizeKeys(false)
      setCurrentPassword("")
      setStepUpToken("")
    } catch {
      // toast in hook
    }
  }

  return (
    <div className="space-y-6">
      <Card id="api-tokens" className="scroll-mt-24">
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
            <div className="space-y-2">
              <Label htmlFor="token-name">New token name</Label>
              <Input
                id="token-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="MCP agent"
                className="sm:max-w-xs"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Access level</legend>
              <p className="text-xs text-muted-foreground">
                Choose what this token may do. Nothing is preselected — a
                one-click token never gets full access by accident.
              </p>
              <div className="grid gap-2 lg:grid-cols-3">
                {ACCESS_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    htmlFor={`token-access-${option.value}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors",
                      access === option.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "hover:bg-accent/40"
                    )}
                  >
                    <input
                      id={`token-access-${option.value}`}
                      type="radio"
                      name="token-access"
                      className="mt-1"
                      checked={access === option.value}
                      onChange={() => {
                        // Leaving shell access drops its implied authorize_keys grant
                        // instead of silently carrying it into a weaker level.
                        if (access === "shell" && option.value !== "shell") {
                          setAllowAuthorizeKeys(false)
                        }
                        setAccess(option.value)
                      }}
                    />
                    <span>
                      <span className="font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex max-w-xl cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={access === "shell" ? true : allowAuthorizeKeys}
                disabled={access === "shell"}
                onChange={(e) => setAllowAuthorizeKeys(e.target.checked)}
              />
              <span>
                <span className="font-medium">
                  Allow this token to add SSH keys to servers
                </span>
                <span className="block text-muted-foreground">
                  Grants <code className="text-xs">authorize_keys</code>: the client may
                  add its own public key to a server&apos;s{" "}
                  <code className="text-xs">authorized_keys</code> (for example{" "}
                  <code className="text-xs">sshya link</code>), so it can SSH in without
                  LazyBackup exporting private keys.{" "}
                  {access === "shell"
                    ? "Included automatically with shell access."
                    : "Works with Read only too. That client gets a shell on every server, so treat it like root SSH."}
                </span>
              </span>
            </label>

            {access === "read_only" && allowAuthorizeKeys ? (
              <div className="flex max-w-xl gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                <span className="font-medium">Warning:</span>
                <span>
                  This “Read only” token can still add its own SSH key to every
                  server, which is effectively shell access. Leave this off or use
                  shell access explicitly.
                </span>
              </div>
            ) : null}

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
                        if (e.target.value) setStepUpToken("")
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
                      {verifyingPasskey ? "Waiting for passkey…" : "Verify with passkey"}
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

            <div className="flex flex-wrap items-center gap-3">
              <LoadingButton
                onClick={handleCreate}
                isLoading={tokensQuery.createToken.isPending}
                disabled={!newName.trim() || !access || !locked || !stepUpReady}
              >
                Create token
              </LoadingButton>
              {!access ? (
                <p className="text-xs text-muted-foreground">
                  Choose an access level to enable Create token.
                </p>
              ) : null}
            </div>
          </div>

          {created && install && (
            <div className="space-y-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
              <div>
                <p className="text-sm font-medium">Token created — copy it now</p>
                <p className="text-sm text-muted-foreground">
                  {secretBannerAvailable
                    ? "The full token is kept in the banner at the top of Settings until you hide it. The install links below embed it."
                    : "This plaintext value is shown once. Install links below embed it."}
                </p>
              </div>

              {!secretBannerAvailable ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="block flex-1 break-all rounded bg-muted px-3 py-2 text-xs">
                    {created.token}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(created.token, "Token")}
                  >
                    Copy token
                  </Button>
                </div>
              ) : null}

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
                  onClick={() => void copyText(install.mcpJson, "mcp.json")}
                >
                  Copy mcp.json
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyText(install.claude, "Claude config")}
                >
                  Copy Claude config
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyText(install.claudeCode, "Claude Code command")}
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
          {created && !install ? (
            <p className="text-sm text-muted-foreground">
              Token created — preparing install links…
            </p>
          ) : null}

          <QueryState
            query={tokensQuery}
            dataLabel="API tokens"
            isDataEmpty={(data) => !data?.length}
            emptyMessage="No active API tokens yet"
            emptyDescription="Create one above to connect an MCP client."
            errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
          >
            <ul className="divide-y rounded-md border">
              {tokensQuery.tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{token.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {token.tokenPrefix} · created {formatDate(token.createdAt)} · last used{' '}
                      {formatDate(token.lastUsedAt)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(token.permissions ?? []).length === 0 ? (
                        <Badge
                          variant="warning"
                          title="Full access: can create, run, and delete backups, and manage servers and connections."
                        >
                          Full access
                        </Badge>
                      ) : (
                        (token.permissions ?? []).map((permission) => {
                          const badge = PERMISSION_BADGES[permission]
                          if (!badge) {
                            return (
                              <Badge key={permission} variant="muted">
                                {permission}
                              </Badge>
                            )
                          }
                          return (
                            <Badge
                              key={permission}
                              variant={badge.variant}
                              title={badge.description}
                            >
                              {badge.label}
                            </Badge>
                          )
                        })
                      )}
                    </div>
                  </div>
                  <ConfirmActionDialog
                    title={`Revoke API token “${token.name}”?`}
                    description="Agents using this token lose access immediately. This cannot be undone — create a new token if you need access again."
                    confirmLabel="Revoke token"
                    pendingLabel="Revoking…"
                    variant="destructive"
                    onConfirm={async () => {
                      await tokensQuery.revokeToken.mutateAsync(token.id)
                      dismiss(`api-token:${token.id}`)
                      if (created?.id === token.id) setCreated(null)
                    }}
                    disabled={tokensQuery.revokeToken.isPending}
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={tokensQuery.revokeToken.isPending}
                    >
                      <TrashIcon className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  </ConfirmActionDialog>
                </li>
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>

      <Card id="mcp-manual" className="scroll-mt-24">
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
