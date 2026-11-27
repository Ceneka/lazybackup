"use client"

import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import { McpSettingsPanel } from "@/components/mcp-settings-panel"
import { EncryptionSettingsPanel } from "@/components/encryption-settings-panel"
import { BroSpaceSettingsPanel } from "@/components/bro-space-settings-panel"
import { FailureWebhookSettings } from "@/components/failure-webhook-settings"
import { SuccessPingSettings } from "@/components/success-ping-settings"
import { PasskeySettingsPanel } from "@/components/passkey-settings-panel"
import { ConfigExportCard, AppVersionFooter } from "@/components/settings-about"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { copyText } from "@/components/settings/copy-button"
import { SecretRevealProvider } from "@/components/settings/secret-reveal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants"
import {
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  formatInTimezone,
  listTimezones,
} from "@/lib/cron/format"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSettings } from "@/lib/hooks/useSettings"
import { SSHKey, SystemSSHKey, fetchSSHKeyInstallCommand, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import {
  AlertCircleIcon,
  ClipboardIcon,
  KeyIcon,
  LockIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  BotIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

const SETTINGS_TABS = ["general", "encryption", "bro", "mcp", "ssh-keys"] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]

function isSettingsTab(value: string | null): value is SettingsTab {
  return Boolean(value) && (SETTINGS_TABS as readonly string[]).includes(value!)
}

function SettingsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get("tab")
  const tab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "general"
  const settingsQuery = useSettings()
  const keysQuery = useSSHKeys()
  const auth = useAuth()

  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyContent, setNewKeyContent] = useState("")
  const [keyContentError, setKeyContentError] = useState<string | null>(null)

  // Local state for settings to avoid cursor jumping
  const [localDefaultSshKeyPath, setLocalDefaultSshKeyPath] = useState("")
  const [localSshKeepAliveInterval, setLocalSshKeepAliveInterval] = useState("")
  const [localTimezone, setLocalTimezone] = useState(DEFAULT_TIMEZONE)
  const [timePreview, setTimePreview] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [revokeTokensOnChange, setRevokeTokensOnChange] = useState(false)

  const timezoneOptions = useMemo(() => {
    const all = listTimezones()
    const preferredSet = new Set<string>(COMMON_TIMEZONES)
    const preferred = [...COMMON_TIMEZONES].filter((tz) => all.includes(tz) || tz === "UTC")
    const rest = all.filter((tz) => !preferredSet.has(tz))
    return { preferred, rest }
  }, [])

  const settingsReady = settingsQuery.hasLoaded
  const savedDefaultSshKeyPath = settingsQuery.settings.defaultSshKeyPath || ""
  const savedSshKeepAliveInterval = settingsQuery.settings.sshKeepAliveInterval || "60"
  const savedTimezone = settingsQuery.settings.timezone || DEFAULT_TIMEZONE

  // Sync local state with settings data. Depend on the individual saved values
  // so saving an unrelated setting does not overwrite unsaved edits here.
  useEffect(() => {
    if (!settingsQuery.hasLoaded) return
    setLocalDefaultSshKeyPath(savedDefaultSshKeyPath)
    setLocalSshKeepAliveInterval(savedSshKeepAliveInterval)
    setLocalTimezone(savedTimezone)
  }, [
    settingsQuery.hasLoaded,
    savedDefaultSshKeyPath,
    savedSshKeepAliveInterval,
    savedTimezone,
  ])

  // Preview the current time in the selected zone (client-only to avoid a
  // hydration mismatch between server and browser clocks).
  useEffect(() => {
    if (!settingsReady) return
    setTimePreview(formatInTimezone(new Date(), localTimezone))
  }, [localTimezone, settingsReady])

  // Scroll to a card anchor after a deep link such as
  // /settings?tab=general#failure-webhook.
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash.replace(/^#/, "")
      if (!hash) return
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    const timer = window.setTimeout(scrollToHash, 60)
    window.addEventListener("hashchange", scrollToHash)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("hashchange", scrollToHash)
    }
  }, [tab])

  const handleTabChange = (next: string) => {
    if (!isSettingsTab(next)) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", next)
    router.replace(`/settings?${params.toString()}`, { scroll: false })
  }

  const generalDirty =
    localTimezone !== savedTimezone ||
    localDefaultSshKeyPath.trim() !== savedDefaultSshKeyPath ||
    localSshKeepAliveInterval.trim() !== savedSshKeepAliveInterval

  const handleSaveGeneral = async () => {
    const keepAlive = localSshKeepAliveInterval.trim()
    if (keepAlive && !/^\d+$/.test(keepAlive)) {
      toast.error("SSH keep-alive interval must be a whole number of seconds")
      return
    }
    const values: Record<string, string> = {}
    if (localTimezone !== savedTimezone) values.timezone = localTimezone
    if (localDefaultSshKeyPath.trim() !== savedDefaultSshKeyPath) {
      values.defaultSshKeyPath = localDefaultSshKeyPath.trim()
    }
    if (keepAlive !== savedSshKeepAliveInterval) {
      values.sshKeepAliveInterval = keepAlive
    }
    try {
      await settingsQuery.updateSettings.mutateAsync({
        values,
        label: "General settings",
      })
    } catch {
      // toast in hook
    }
  }

  const clearPasswordFields = () => {
    setNewPassword("")
    setConfirmPassword("")
    setCurrentPassword("")
  }

  const handleSetPassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    try {
      await auth.updatePassword.mutateAsync({
        action: "set",
        password: newPassword,
      })
      clearPasswordFields()
    } catch {
      // toast in hook
    }
  }

  const handleChangePassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    try {
      await auth.updatePassword.mutateAsync({
        action: "change",
        currentPassword,
        password: newPassword,
        revokeApiTokens: revokeTokensOnChange,
      })
      setRevokeTokensOnChange(false)
      clearPasswordFields()
    } catch {
      // toast in hook
    }
  }

  const handleRemovePassword = async () => {
    if (!currentPassword) {
      toast.error("Enter your current password to remove protection")
      return
    }
    await auth.updatePassword.mutateAsync({
      action: "remove",
      currentPassword,
    })
    clearPasswordFields()
  }

  const handleAddKey = async () => {
    const name = newKeyName.trim()
    const content = newKeyContent.trim()

    if (!name) {
      toast.error("Key name is required")
      return
    }
    if (!content) {
      setKeyContentError(
        "Paste the private key content — a name alone can’t authenticate anything."
      )
      return
    }
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
      setKeyContentError(
        "That doesn’t look like a private key. Paste an OpenSSH/PEM key starting with “-----BEGIN … PRIVATE KEY-----”."
      )
      return
    }
    setKeyContentError(null)

    try {
      await keysQuery.addKey.mutateAsync({
        name,
        privateKeyContent: content,
      })

      // Reset form
      setNewKeyName("")
      setNewKeyContent("")
    } catch {
      // Error handling is done in the mutation
    }
  }

  const handleDeleteKey = async (id: string) => {
    await keysQuery.deleteKey.mutateAsync(id)
  }

  const handleCopyInstallCommand = async (id: string) => {
    try {
      const { installCommand } = await fetchSSHKeyInstallCommand(id)
      await copyText(installCommand, "Install command")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy install command")
    }
  }

  const handleAddSystemKey = async (systemKey: { name: string, privateKeyPath: string }) => {
    try {
      await keysQuery.addKey.mutateAsync({
        name: systemKey.name,
        privateKeyPath: systemKey.privateKeyPath
      })
    } catch {
      // Error handling is done in the mutation
    }
  }

  const authEnabled = Boolean(auth.data?.authEnabled)
  const hasPassword = Boolean(auth.data?.hasPassword)
  const hasPasskeys = Boolean(auth.data?.hasPasskeys)

  const storedKeysQuery = {
    data: keysQuery.hasData ? keysQuery.keys : undefined,
    isLoading: keysQuery.isLoading,
    isFetching: keysQuery.isFetching,
    isError: keysQuery.isError,
    error: keysQuery.error,
    refetch: keysQuery.refetch,
  }
  const systemKeysQuery = {
    data: keysQuery.hasData ? keysQuery.systemKeys : undefined,
    isLoading: keysQuery.isLoading,
    isFetching: keysQuery.isFetching,
    isError: keysQuery.isError,
    error: keysQuery.error,
    refetch: keysQuery.refetch,
  }

  return (
    <PageLayout>
      <PageHeader
        title="Settings"
        description="Timezone, notifications, security, encryption, Bro Space, API access, and SSH keys."
      />

      <SecretRevealProvider>
        {settingsQuery.isError && !settingsReady ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <AlertCircleIcon className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Couldn’t load settings</p>
              <p className="text-muted-foreground">
                {settingsQuery.error instanceof Error
                  ? settingsQuery.error.message
                  : "The settings API did not respond."}{" "}
                Editable fields stay hidden until settings load so a save can’t
                overwrite them with defaults.
              </p>
            </div>
            <LoadingButton
              variant="outline"
              size="sm"
              isLoading={settingsQuery.isFetching}
              loadingText="Retrying…"
              onClick={() => void settingsQuery.refetch()}
            >
              Retry
            </LoadingButton>
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
          <div className="sticky top-14 z-40 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <TabsList className="grid h-auto w-full grid-cols-5 gap-0.5 p-1">
              <TabsTrigger
                value="general"
                className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
              >
                <SettingsIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">General</span>
              </TabsTrigger>
              <TabsTrigger
                value="encryption"
                className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
              >
                <ShieldIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">Encrypt</span>
              </TabsTrigger>
              <TabsTrigger
                value="bro"
                className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
              >
                <UsersIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">Bro</span>
              </TabsTrigger>
              <TabsTrigger
                value="mcp"
                className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
              >
                <BotIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">API</span>
              </TabsTrigger>
              <TabsTrigger
                value="ssh-keys"
                className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-xs leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
              >
                <KeyIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">SSH</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="general" className="mt-6 space-y-6">
            {!settingsReady ? (
              settingsQuery.isError ? null : (
                <Card>
                  <CardContent className="py-6 text-sm text-muted-foreground">
                    Loading settings…
                  </CardContent>
                </Card>
              )
            ) : (
              <>
                <Card id="general" className="w-full scroll-mt-24">
                  <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>
                      Configure global application settings.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="timezone">Timezone</Label>
                        <select
                          id="timezone"
                          value={localTimezone}
                          onChange={(e) => setLocalTimezone(e.target.value)}
                          className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <optgroup label="Common">
                            {timezoneOptions.preferred.map((tz) => (
                              <option key={tz} value={tz}>
                                {tz}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="All timezones">
                            {timezoneOptions.rest.map((tz) => (
                              <option key={tz} value={tz}>
                                {tz}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Cron schedules (e.g. <code>0 0 * * *</code> = midnight) use this
                          timezone, independent of the host clock. For Argentina choose{" "}
                          <code>America/Argentina/Buenos_Aires</code>.
                        </p>
                        {timePreview ? (
                          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                            Current time in this zone:{" "}
                            <span className="font-medium text-foreground">{timePreview}</span>
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <Label htmlFor="defaultSshKeyPath">Default SSH Key Path</Label>
                        <Input
                          id="defaultSshKeyPath"
                          value={localDefaultSshKeyPath}
                          onChange={(e) => setLocalDefaultSshKeyPath(e.target.value)}
                          placeholder="~/.ssh/id_rsa"
                          className="mt-1"
                        />
                        <p className="mt-1 text-sm text-muted-foreground">
                          The default path to look for SSH keys on the system
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="sshKeepAliveInterval">SSH Keep-Alive Interval (seconds)</Label>
                        <Input
                          id="sshKeepAliveInterval"
                          type="number"
                          min={1}
                          value={localSshKeepAliveInterval}
                          onChange={(e) => setLocalSshKeepAliveInterval(e.target.value)}
                          placeholder="60"
                          className="mt-1"
                        />
                        <p className="mt-1 text-sm text-muted-foreground">
                          Send a keep-alive packet at this interval to prevent connection timeout
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <LoadingButton
                        type="button"
                        onClick={() => void handleSaveGeneral()}
                        isLoading={settingsQuery.updateSettings.isPending}
                        loadingText="Saving…"
                        disabled={!generalDirty}
                      >
                        Save changes
                      </LoadingButton>
                      <span className="text-xs text-muted-foreground">
                        {generalDirty ? "Unsaved changes" : "All changes saved"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card id="failure-webhook" className="w-full scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Failure webhook</CardTitle>
                    <CardDescription>
                      Notify Discord, Telegram, Uptime Kuma, ntfy, Slack, or any HTTP endpoint when a backup fails.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FailureWebhookSettings settings={settingsQuery} />
                  </CardContent>
                </Card>

                <Card id="success-ping" className="w-full scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Success ping</CardTitle>
                    <CardDescription>
                      Healthchecks.io-style ping (or any URL) when a backup succeeds. Independent of the failure webhook.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SuccessPingSettings settings={settingsQuery} />
                  </CardContent>
                </Card>

                <Card id="app-password" className="w-full scroll-mt-24">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <LockIcon className="h-5 w-5" />
                      App password
                    </CardTitle>
                    <CardDescription>
                      Optional lock for the whole dashboard and APIs. Scheduled backups are unaffected.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Status:{" "}
                      <span className="font-medium text-foreground">
                        {auth.isLoading
                          ? "Loading…"
                          : hasPassword
                            ? "Password set"
                            : authEnabled
                              ? "No password (passkey or other lock)"
                              : "Open (no password / passkey)"}
                      </span>
                    </p>

                    {!hasPassword ? (
                      <div className="max-w-md space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="set-password">New password</Label>
                          <Input
                            id="set-password"
                            type="password"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                          />
                          <p className="text-xs text-muted-foreground">
                            At least {MIN_PASSWORD_LENGTH} characters.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="set-confirm">Confirm password</Label>
                          <Input
                            id="set-confirm"
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                          />
                        </div>
                        <LoadingButton
                          onClick={() => void handleSetPassword()}
                          isLoading={auth.updatePassword.isPending}
                          loadingText="Saving…"
                          disabled={!newPassword || !confirmPassword}
                        >
                          Enable password protection
                        </LoadingButton>
                      </div>
                    ) : (
                      <div className="space-y-4 max-w-md">
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="current-password">Current password</Label>
                            <Input
                              id="current-password"
                              type="password"
                              autoComplete="current-password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="change-password">New password</Label>
                            <Input
                              id="change-password"
                              type="password"
                              autoComplete="new-password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="change-confirm">Confirm new password</Label>
                            <Input
                              id="change-confirm"
                              type="password"
                              autoComplete="new-password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                          </div>
                          <label className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={revokeTokensOnChange}
                              onChange={(e) => setRevokeTokensOnChange(e.target.checked)}
                            />
                            <span>
                              <span className="font-medium">Revoke all API tokens</span>
                              <span className="block text-muted-foreground">
                                Use this if the old password may have leaked. Agents
                                using existing tokens lose access immediately.
                              </span>
                            </span>
                          </label>
                          <LoadingButton
                            onClick={() => void handleChangePassword()}
                            isLoading={
                              auth.updatePassword.isPending &&
                              auth.updatePassword.variables?.action === "change"
                            }
                            loadingText="Updating…"
                            disabled={!currentPassword || !newPassword || !confirmPassword}
                          >
                            Change password
                          </LoadingButton>
                        </div>

                        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                          <p className="text-sm font-medium text-destructive">
                            Remove password protection
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {hasPasskeys
                              ? "Passkeys will still protect this instance. The app password will stop working; vault operations will ask for a passkey instead."
                              : "The dashboard and API will be unlocked. Anyone who can reach this URL can manage backups, servers, and settings."}
                          </p>
                          <ConfirmActionDialog
                            title="Remove the app password?"
                            description={
                              hasPasskeys
                                ? "Passkeys will still protect this instance. The password will stop working, and sensitive vault operations will ask for a passkey instead."
                                : "The dashboard and API will be unlocked. Anyone who can reach this URL will be able to manage LazyBackup."
                            }
                            confirmLabel="Remove password"
                            pendingLabel="Removing…"
                            variant="destructive"
                            onConfirm={handleRemovePassword}
                            disabled={!currentPassword}
                          >
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={!currentPassword}
                            >
                              Remove password
                            </Button>
                          </ConfirmActionDialog>
                          {!currentPassword ? (
                            <p className="text-xs text-muted-foreground">
                              Enter your current password above to enable removal.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            <PasskeySettingsPanel />

            <ConfigExportCard />
          </TabsContent>

          <TabsContent value="encryption" className="mt-6 space-y-6">
            <EncryptionSettingsPanel />
          </TabsContent>

          <TabsContent value="bro" className="mt-6 space-y-6">
            <BroSpaceSettingsPanel />
          </TabsContent>

          <TabsContent value="mcp" className="mt-6 space-y-6">
            <McpSettingsPanel />
          </TabsContent>

          <TabsContent value="ssh-keys" className="mt-6">
            <div className="mb-6">
              <SSHKeyBootstrap />
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card id="ssh-keys" className="w-full scroll-mt-24">
                <CardHeader>
                  <CardTitle>Stored SSH Keys</CardTitle>
                  <CardDescription>
                    SSH keys saved in the application database.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <QueryState
                    query={storedKeysQuery}
                    dataLabel="SSH keys"
                    errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
                    emptyIcon={<KeyIcon className="h-12 w-12 text-muted-foreground" />}
                    emptyMessage="No SSH keys stored in the database"
                    emptyDescription="Add a private key below, or generate one with LazyBackup."
                    isDataEmpty={(data) => !data?.length}
                  >
                    <div className="space-y-4">
                      {keysQuery.keys.map((key: SSHKey) => {
                        const servers = key.usedByServers ?? []
                        const gitReposUsed = key.usedByGitRepos ?? []
                        const inUse = servers.length > 0 || gitReposUsed.length > 0
                        const hasMaterial = Boolean(
                          key.privateKeyPath || key.hasPrivateKeyContent || key.privateKeyContent
                        )
                        const usageText = [
                          servers.map((server) => server.name).join(", "),
                          gitReposUsed.map((repo) => repo.name).join(", "),
                        ]
                          .filter(Boolean)
                          .join(", ")

                        return (
                          <div key={key.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{key.name}</p>
                              {!hasMaterial ? (
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                  No key material — delete this entry and add the key again
                                </p>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  {key.privateKeyPath
                                    ? `Path: ${key.privateKeyPath}`
                                    : "Stored in database"}
                                </p>
                              )}
                              {servers.length > 0 && (
                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                  Used by servers:{" "}
                                  {servers.map((server, i) => (
                                    <span key={server.id}>
                                      {i > 0 ? ", " : ""}
                                      <Link
                                        href={`/servers/${server.id}`}
                                        className="underline hover:no-underline"
                                      >
                                        {server.name}
                                      </Link>
                                    </span>
                                  ))}
                                </p>
                              )}
                              {gitReposUsed.length > 0 && (
                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                  Used by Git repositories:{" "}
                                  {gitReposUsed.map((repo, i) => (
                                    <span key={repo.id}>
                                      {i > 0 ? ", " : ""}
                                      <Link
                                        href={`/git-repos/${repo.id}`}
                                        className="underline hover:no-underline"
                                      >
                                        {repo.name}
                                      </Link>
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center">
                              {hasMaterial && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Copy install command"
                                  aria-label={`Copy install command for ${key.name}`}
                                  onClick={() => handleCopyInstallCommand(key.id)}
                                >
                                  <ClipboardIcon className="h-4 w-4" />
                                </Button>
                              )}
                              {inUse ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled
                                  title={`Used by ${usageText} — reassign before deleting`}
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  <span className="sr-only">
                                    Delete {key.name} (in use)
                                  </span>
                                </Button>
                              ) : (
                                <DeleteConfirmationDialog
                                  title={`Delete SSH key “${key.name}”?`}
                                  description="This removes the key from LazyBackup. Host authorized_keys are not changed."
                                  onConfirm={async () => {
                                    await handleDeleteKey(key.id)
                                  }}
                                  triggerButtonClassName="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                >
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={`Delete ${key.name}`}
                                    disabled={keysQuery.deleteKey.isPending}
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                    <span className="sr-only">Delete {key.name}</span>
                                  </Button>
                                </DeleteConfirmationDialog>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </QueryState>
                </CardContent>
                {keysQuery.hasData ? (
                  <CardFooter className="flex flex-col space-y-4">
                  <div className="grid w-full gap-1.5">
                    <Label htmlFor="new-key-name">Key Name</Label>
                    <Input
                      id="new-key-name"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="My SSH Key"
                    />
                  </div>
                  <div className="grid w-full gap-1.5">
                    <Label htmlFor="new-key-content">Private key content</Label>
                    <Textarea
                      id="new-key-content"
                      value={newKeyContent}
                      onChange={(e) => {
                        setNewKeyContent(e.target.value)
                        setKeyContentError(null)
                      }}
                      placeholder="Paste your private key content here (required)"
                      className="min-h-[100px]"
                      aria-invalid={Boolean(keyContentError) || undefined}
                      aria-describedby="new-key-content-help"
                    />
                    <p id="new-key-content-help" className="text-xs text-muted-foreground">
                      Required. Paste the full private key, including the BEGIN/END
                      lines. A name alone creates an unusable key.
                    </p>
                    {keyContentError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {keyContentError}
                      </p>
                    ) : null}
                  </div>
                  <LoadingButton
                    className="w-full"
                    onClick={() => void handleAddKey()}
                    isLoading={keysQuery.addKey.isPending}
                    loadingText="Adding..."
                    disabled={!newKeyName.trim() || !newKeyContent.trim()}
                  >
                    <PlusIcon className="mr-2 h-4 w-4" />
                    Add SSH Key
                  </LoadingButton>
                </CardFooter>
                ) : null}
              </Card>

              <Card className="w-full">
                <CardHeader>
                  <CardTitle>System SSH Keys</CardTitle>
                  <CardDescription>
                    SSH keys found on your system that can be used with LazyBackup.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <QueryState
                    query={systemKeysQuery}
                    dataLabel="system SSH keys"
                    errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
                    emptyIcon={<KeyIcon className="h-12 w-12 text-muted-foreground" />}
                    emptyMessage="No SSH keys found on your system"
                    isDataEmpty={(data) => !data?.length}
                  >
                    <div className="space-y-4">
                      {keysQuery.systemKeys.map((key: SystemSSHKey) => (
                        <div key={key.privateKeyPath} className="flex items-center justify-between rounded-md border p-3">
                          <div>
                            <p className="font-medium">{key.name}</p>
                            <p className="text-sm text-muted-foreground">
                              Path: {key.privateKeyPath}
                            </p>
                          </div>
                          <LoadingButton
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddSystemKey(key)}
                            isLoading={keysQuery.addKey.isPending}
                          >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Add to Library
                          </LoadingButton>
                        </div>
                      ))}
                    </div>
                  </QueryState>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </SecretRevealProvider>
      <AppVersionFooter />
    </PageLayout>
  )
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <PageLayout>
          <PageHeader title="Settings" />
          <div className="flex justify-center py-12 text-muted-foreground">Loading…</div>
        </PageLayout>
      }
    >
      <SettingsPageInner />
    </Suspense>
  )
}
