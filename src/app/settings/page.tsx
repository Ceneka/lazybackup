"use client"

import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import { McpSettingsPanel } from "@/components/mcp-settings-panel"
import { EncryptionSettingsPanel } from "@/components/encryption-settings-panel"
import { BroSpaceSettingsPanel } from "@/components/bro-space-settings-panel"
import { FailureWebhookSettings } from "@/components/failure-webhook-settings"
import { SuccessPingSettings } from "@/components/success-ping-settings"
import { PasskeySettingsPanel } from "@/components/passkey-settings-panel"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { COMMON_TIMEZONES, DEFAULT_TIMEZONE, listTimezones } from "@/lib/cron/format"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSettings } from "@/lib/hooks/useSettings"
import { SSHKey, SystemSSHKey, fetchSSHKeyInstallCommand, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { useQueryClient } from "@tanstack/react-query"
import { ClipboardIcon, KeyIcon, LockIcon, PlusIcon, SettingsIcon, TrashIcon, BotIcon, ShieldIcon, UsersIcon } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { toast } from "sonner"

function SettingsPageInner() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<string>("general")

  useLayoutEffect(() => {
    const t = searchParams.get("tab")
    if (t === "ssh-keys" || t === "general" || t === "mcp" || t === "encryption" || t === "bro") {
      setTab(t)
    } else {
      setTab("general")
    }
  }, [searchParams])
  const settingsQuery = useSettings()
  const keysQuery = useSSHKeys()
  const auth = useAuth()
  const queryClient = useQueryClient()

  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyContent, setNewKeyContent] = useState("")

  // Local state for settings to avoid cursor jumping
  const [localDefaultSshKeyPath, setLocalDefaultSshKeyPath] = useState("")
  const [localSshKeepAliveInterval, setLocalSshKeepAliveInterval] = useState("")
  const [localTimezone, setLocalTimezone] = useState(DEFAULT_TIMEZONE)

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")

  const timezoneOptions = useMemo(() => {
    const all = listTimezones()
    const preferredSet = new Set<string>(COMMON_TIMEZONES)
    const preferred = [...COMMON_TIMEZONES].filter((tz) => all.includes(tz) || tz === "UTC")
    const rest = all.filter((tz) => !preferredSet.has(tz))
    return { preferred, rest }
  }, [])

  // Sync local state with settings data
  useEffect(() => {
    if (settingsQuery.settings) {
      setLocalDefaultSshKeyPath(settingsQuery.settings.defaultSshKeyPath || "")
      setLocalSshKeepAliveInterval(settingsQuery.settings.sshKeepAliveInterval || "60")
      setLocalTimezone(settingsQuery.settings.timezone || DEFAULT_TIMEZONE)
    }
  }, [settingsQuery.settings])

  // Handlers for saving settings
  const handleSaveDefaultSshKeyPath = (value: string) => {
    settingsQuery.updateSetting.mutate({ key: "defaultSshKeyPath", value })
  }

  const handleSaveSshKeepAliveInterval = (value: string) => {
    settingsQuery.updateSetting.mutate({ key: "sshKeepAliveInterval", value })
  }

  const handleSaveTimezone = (value: string) => {
    setLocalTimezone(value)
    settingsQuery.updateSetting.mutate(
      { key: "timezone", value },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] })
          queryClient.invalidateQueries({ queryKey: ["backup"] })
          queryClient.invalidateQueries({ queryKey: ["backups"] })
        },
      }
    )
  }

  const clearPasswordFields = () => {
    setNewPassword("")
    setConfirmPassword("")
    setCurrentPassword("")
  }

  const handleSetPassword = async () => {
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
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    try {
      await auth.updatePassword.mutateAsync({
        action: "change",
        currentPassword,
        password: newPassword,
      })
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
    if (!confirm("Remove the app password? The dashboard will be open again.")) {
      return
    }
    try {
      await auth.updatePassword.mutateAsync({
        action: "remove",
        currentPassword,
      })
      clearPasswordFields()
    } catch {
      // toast in hook
    }
  }

  const handleAddKey = async () => {
    if (!newKeyName) {
      toast.error("Key name is required")
      return
    }

    try {
      await keysQuery.addKey.mutateAsync({
        name: newKeyName,
        privateKeyContent: newKeyContent || undefined
      })

      // Reset form
      setNewKeyName("")
      setNewKeyContent("")
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  const handleDeleteKey = async (id: string) => {
    try {
      await keysQuery.deleteKey.mutateAsync(id)
    } catch {
      // toast in mutation
    }
  }

  const handleCopyInstallCommand = async (id: string) => {
    try {
      const { installCommand } = await fetchSSHKeyInstallCommand(id)
      await navigator.clipboard.writeText(installCommand)
      toast.success("Install command copied — paste it on the host")
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
      toast.success(`System key '${systemKey.name}' added to database`)
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  const authEnabled = Boolean(auth.data?.authEnabled)
  const hasPassword = Boolean(auth.data?.hasPassword)

  return (
    <PageLayout>
      <PageHeader title="Settings" />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-5 gap-0.5 p-1">
          <TabsTrigger
            value="general"
            className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
          >
            <SettingsIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">General</span>
          </TabsTrigger>
          <TabsTrigger
            value="encryption"
            className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
          >
            <ShieldIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">Encrypt</span>
          </TabsTrigger>
          <TabsTrigger
            value="bro"
            className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
          >
            <UsersIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">Bro</span>
          </TabsTrigger>
          <TabsTrigger
            value="mcp"
            className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
          >
            <BotIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">API</span>
          </TabsTrigger>
          <TabsTrigger
            value="ssh-keys"
            className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm"
          >
            <KeyIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">SSH</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6 space-y-6">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>
                Configure global application settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <QueryState
                query={settingsQuery}
                dataLabel="settings"
                errorIcon={<SettingsIcon className="h-12 w-12 text-red-500" />}
              >
                {settingsQuery.settings && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="timezone">Timezone</Label>
                      <select
                        id="timezone"
                        value={localTimezone}
                        onChange={(e) => handleSaveTimezone(e.target.value)}
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
                      <p className="text-sm text-muted-foreground mt-1">
                        Cron schedules (e.g. <code>0 0 * * *</code> = midnight) use this timezone,
                        independent of the host clock. For Argentina choose{" "}
                        <code>America/Argentina/Buenos_Aires</code>.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="defaultSshKeyPath">Default SSH Key Path</Label>
                      <Input
                        id="defaultSshKeyPath"
                        value={localDefaultSshKeyPath}
                        onChange={(e) => setLocalDefaultSshKeyPath(e.target.value)}
                        onBlur={(e) => handleSaveDefaultSshKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_rsa"
                        className="mt-1"
                      />
                      <p className="text-sm text-muted-foreground mt-1">
                        The default path to look for SSH keys on the system
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="sshKeepAliveInterval">SSH Keep-Alive Interval (seconds)</Label>
                      <Input
                        id="sshKeepAliveInterval"
                        type="number"
                        value={localSshKeepAliveInterval}
                        onChange={(e) => setLocalSshKeepAliveInterval(e.target.value)}
                        onBlur={(e) => handleSaveSshKeepAliveInterval(e.target.value)}
                        placeholder="60"
                        className="mt-1"
                      />
                      <p className="text-sm text-muted-foreground mt-1">
                        Send a keep-alive packet at this interval to prevent connection timeout
                      </p>
                    </div>
                  </div>
                )}
              </QueryState>
            </CardContent>
          </Card>

          <Card className="w-full">
            <CardHeader>
              <CardTitle>Failure webhook</CardTitle>
              <CardDescription>
                Notify Discord, Telegram, Uptime Kuma, ntfy, Slack, or any HTTP endpoint when a backup fails.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QueryState
                query={settingsQuery}
                dataLabel="webhook settings"
                errorIcon={<SettingsIcon className="h-12 w-12 text-red-500" />}
              >
                {settingsQuery.settings && (
                  <FailureWebhookSettings settings={settingsQuery} />
                )}
              </QueryState>
            </CardContent>
          </Card>

          <Card className="w-full">
            <CardHeader>
              <CardTitle>Success ping</CardTitle>
              <CardDescription>
                Healthchecks.io-style ping (or any URL) when a backup succeeds. Independent of the failure webhook.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QueryState
                query={settingsQuery}
                dataLabel="success ping settings"
                errorIcon={<SettingsIcon className="h-12 w-12 text-red-500" />}
              >
                {settingsQuery.settings && (
                  <SuccessPingSettings settings={settingsQuery} />
                )}
              </QueryState>
            </CardContent>
          </Card>

          <Card className="w-full">
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
                <div className="space-y-3 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="set-password">New password</Label>
                    <Input
                      id="set-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 12 characters"
                    />
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
                <div className="space-y-3 max-w-md">
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
                      placeholder="Leave blank to only remove"
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
                  <div className="flex flex-wrap gap-2">
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
                    <LoadingButton
                      variant="outline"
                      onClick={() => void handleRemovePassword()}
                      isLoading={
                        auth.updatePassword.isPending &&
                        auth.updatePassword.variables?.action === "remove"
                      }
                      loadingText="Removing…"
                      disabled={!currentPassword}
                    >
                      Remove password
                    </LoadingButton>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <PasskeySettingsPanel />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="w-full">
              <CardHeader>
                <CardTitle>Stored SSH Keys</CardTitle>
                <CardDescription>
                  SSH keys saved in the application database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QueryState
                  query={{
                    isLoading: keysQuery.isLoading,
                    data: keysQuery.keys,
                    error: null,
                    isError: false
                  }}
                  dataLabel="SSH keys"
                  errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
                  emptyIcon={<KeyIcon className="h-12 w-12 text-muted-foreground" />}
                  emptyMessage="No SSH keys stored in the database"
                  isDataEmpty={(data) => !data?.length}
                >
                  {keysQuery.keys.length > 0 && (
                    <div className="space-y-4">
                      {keysQuery.keys.map((key: SSHKey) => (
                        <div key={key.id} className="flex items-start justify-between border p-3 rounded-md gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{key.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {key.privateKeyPath ? `Path: ${key.privateKeyPath}` : 'Stored in database'}
                            </p>
                            {(key.usedByServers?.length ?? 0) > 0 && (
                              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                Used by{" "}
                                {key.usedByServers!.map((server, i) => (
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
                          </div>
                          <div className="flex shrink-0 items-center">
                            {(key.hasPrivateKeyContent || key.privateKeyContent || key.privateKeyPath) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Copy install command"
                                onClick={() => handleCopyInstallCommand(key.id)}
                              >
                                <ClipboardIcon className="h-4 w-4" />
                                <span className="sr-only">Copy install command</span>
                              </Button>
                            )}
                            <DeleteConfirmationDialog
                              title="Delete this SSH key?"
                              description={
                                (key.usedByServers?.length ?? 0) > 0
                                  ? "This key is still assigned to servers. Delete will be blocked until you reassign those servers."
                                  : "This removes the key from LazyBackup. Host authorized_keys are not changed."
                              }
                              onDelete={() => handleDeleteKey(key.id)}
                              isDeleting={keysQuery.deleteKey.isPending}
                              buttonText="Delete"
                              triggerButtonClassName="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            >
                              <Button variant="ghost" size="icon" disabled={keysQuery.deleteKey.isPending}>
                                <TrashIcon className="h-4 w-4" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            </DeleteConfirmationDialog>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </QueryState>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <div className="grid w-full gap-1.5">
                  <Label htmlFor="name">Key Name</Label>
                  <Input
                    id="name"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="My SSH Key"
                  />
                </div>
                <div className="grid w-full gap-1.5">
                  <Label htmlFor="content">Private Key Content (Optional)</Label>
                  <Textarea
                    id="content"
                    value={newKeyContent}
                    onChange={(e) => setNewKeyContent(e.target.value)}
                    placeholder="Paste your private key content here"
                    className="min-h-[100px]"
                  />
                </div>
                <LoadingButton
                  className="w-full"
                  onClick={handleAddKey}
                  isLoading={keysQuery.addKey.isPending}
                  loadingText="Adding..."
                  disabled={!newKeyName}
                >
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add SSH Key
                </LoadingButton>
              </CardFooter>
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
                  query={{
                    isLoading: keysQuery.isLoading,
                    data: keysQuery.systemKeys,
                    error: null,
                    isError: false
                  }}
                  dataLabel="system SSH keys"
                  errorIcon={<KeyIcon className="h-12 w-12 text-red-500" />}
                  emptyIcon={<KeyIcon className="h-12 w-12 text-muted-foreground" />}
                  emptyMessage="No SSH keys found on your system"
                  isDataEmpty={(data) => !data?.length}
                >
                  {keysQuery.systemKeys.length > 0 && (
                    <div className="space-y-4">
                      {keysQuery.systemKeys.map((key: SystemSSHKey) => (
                        <div key={key.privateKeyPath} className="flex items-center justify-between border p-3 rounded-md">
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
                  )}
                </QueryState>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
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
