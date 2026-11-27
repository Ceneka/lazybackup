"use client"

import {
  ConnectionTestResultPanel,
  ServerTransportDetails,
} from "@/components/connections/connection-test-result"
import { FieldError, PasswordInput } from "@/components/connections/form-controls"
import { PasswordAuthWarning } from "@/components/connections/server-auth"
import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import { Button } from '@/components/ui/button'
import { DataState } from "@/components/ui/data-state"
import { ApiError, readApiError } from "@/lib/api/client-error"
import {
  testServerFromForm,
  useServer,
  useTestServer,
  type ServerTestResult,
} from '@/lib/hooks/useServers'
import { getSystemKeyPathFromId, isSystemKeyId, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { useQueryClient } from "@tanstack/react-query"
import { KeyIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type TestOutcome = ServerTestResult & {
  testedAt?: number
  testedLabel?: string
}

type SshKeyOption = {
  id: string
  name: string
  privateKeyPath?: string | null
  isSystemKey?: boolean
}

export default function EditServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [testError, setTestError] = useState<string | null>(null)
  const [testFieldErrors, setTestFieldErrors] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<TestOutcome | null>(null)
  const { keys, allKeys, isLoading: keysLoading } = useSSHKeys(true) // Include system keys

  const [testingBackup, setTestingBackup] = useState(false)

  const serverTestQuery = useTestServer(serverId)
  const {
    data: server,
    isLoading,
    isError,
    isFetching,
    error,
    refetch,
  } = useServer(serverId)

  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
    sshKeyId: '',
    systemKeyPath: '',
  })

  const notFound = isError && error instanceof ApiError && error.status === 404
  const fetchError =
    isError && !notFound
      ? error instanceof Error
        ? error.message
        : "Failed to fetch server"
      : null

  // Update form data when server data is loaded
  useEffect(() => {
    if (server) {
      setFormData({
        name: server.name || '',
        host: server.host || '',
        port: server.port || 22,
        username: server.username || '',
        // Secrets are never returned by the API — leave blank to keep existing
        password: '',
        privateKey: '',
        sshKeyId: server.sshKeyId || '',
        systemKeyPath: server.systemKeyPath || '',
      })
      setAuthType(server.authType || 'password')
    }
  }, [server])

  function clearTestState() {
    setTestResult(null)
    setTestError(null)
    setTestFieldErrors({})
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'port' ? parseInt(value) || 22 : value
    }))
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
    setFormError(null)
    clearTestState()
  }

  const handleAuthTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAuthType(e.target.value as 'password' | 'key')
    clearTestState()
  }

  function handleSshKeySelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value
    setFormData((prev) => ({
      ...prev,
      privateKey: "",
      sshKeyId: isSystemKeyId(raw) ? "" : raw,
      systemKeyPath: isSystemKeyId(raw) ? getSystemKeyPathFromId(raw) : "",
    }))
    clearTestState()
  }

  const errorFor = (name: string) => testFieldErrors[name] ?? fieldErrors[name]

  function buildPayload() {
    return {
      ...formData,
      authType,
      // Only include authentication data based on authType and selected key type
      password: authType === 'password' && formData.password.trim() ? formData.password : undefined,
      privateKey:
        authType === 'key' && !formData.sshKeyId && !formData.systemKeyPath && formData.privateKey.trim()
          ? formData.privateKey
          : undefined,
      sshKeyId: authType === 'key' && formData.sshKeyId ? formData.sshKeyId : undefined,
      systemKeyPath: authType === 'key' && formData.systemKeyPath ? formData.systemKeyPath : undefined,
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setFormError(null)
    setFieldErrors({})

    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildPayload()),
      })

      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        setFormError(message)
        setFieldErrors(fieldErrors)
        return
      }

      queryClient.invalidateQueries({ queryKey: ['servers'] })

      toast.success('Server updated successfully')
      router.push(`/servers/${serverId}`)
    } catch (error) {
      console.error('Error updating server:', error)
      setFormError(error instanceof Error ? error.message : 'Failed to update server')
    } finally {
      setLoading(false)
    }
  }

  const handleTestServer = async () => {
    if (!server) return
    clearTestState()
    setTestingBackup(true)
    let testedLabel = "Connection test"

    try {
      const nextErrors: Record<string, string> = {}
      if (!formData.host.trim()) nextErrors.host = "Host is required"
      if (!formData.username.trim()) nextErrors.username = "Username is required"
      if (!formData.port || formData.port < 1 || formData.port > 65535) {
        nextErrors.port = "Port must be between 1 and 65535"
      }

      const hostUnchanged = formData.host.trim() === server.host
      const portUnchanged = Number(formData.port) === server.port
      const userUnchanged = formData.username.trim() === server.username
      const authUnchanged = authType === server.authType
      const keyUnchanged =
        (formData.sshKeyId || "") === (server.sshKeyId || "") &&
        (formData.systemKeyPath || "") === (server.systemKeyPath || "")
      const passwordBlank = !formData.password.trim()
      const privateKeyBlank = !formData.privateKey.trim()

      // Blank secrets can only fall back to the saved row when the connection
      // fields still point at that row — otherwise the result would describe
      // credentials the user just changed.
      const canUseStored =
        hostUnchanged &&
        portUnchanged &&
        userUnchanged &&
        authUnchanged &&
        (authType === "password" ? passwordBlank : keyUnchanged && privateKeyBlank)

      if (authType === "password" && passwordBlank && !canUseStored) {
        nextErrors.password = "Enter the password to test these changes"
      }
      if (
        authType === "key" &&
        !formData.sshKeyId &&
        !formData.systemKeyPath &&
        privateKeyBlank &&
        !canUseStored
      ) {
        nextErrors.privateKey = "Paste the private key to test these changes"
      }

      if (Object.keys(nextErrors).length > 0) {
        setTestFieldErrors(nextErrors)
        setTestError("Fix the highlighted fields to test the connection.")
        return
      }

      if (canUseStored) {
        testedLabel = `Saved server · ${server.username}@${server.host}:${server.port}`
        const { data, isError: testIsError, error: testErrorValue } =
          await serverTestQuery.refetch()
        if (testIsError || !data) {
          throw testErrorValue instanceof Error
            ? testErrorValue
            : new Error("Failed to test server")
        }
        setTestResult({ ...data, testedAt: Date.now(), testedLabel })
        return
      }

      testedLabel = `Current form values · ${formData.username}@${formData.host}:${formData.port}`
      const result = await testServerFromForm(buildPayload())
      setTestResult({ ...result, testedAt: Date.now(), testedLabel })
    } catch (error) {
      if (error instanceof ApiError) setTestFieldErrors(error.fieldErrors)
      setTestResult({
        success: false,
        rsyncAvailable: false,
        scpAvailable: false,
        dockerAvailable: false,
        message: error instanceof Error ? error.message : "Failed to test server",
        testedAt: Date.now(),
        testedLabel,
      })
    } finally {
      setTestingBackup(false)
    }
  }

  return (
    <ResourceEditLayout
      backHref={`/servers/${serverId}`}
      backLabel="Back to server details"
      title="Edit server"
    >
      <DataState
        isLoading={isLoading}
        error={fetchError}
        isEmpty={notFound}
        emptyMessage="Server not found"
        emptyDescription="The server you're trying to edit doesn't exist or has been deleted."
        emptyAction={
          <Link
            href="/connections?tab=servers"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to servers
          </Link>
        }
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      >
        {server ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">
                  Server Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="My Server"
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? "server-name-error" : undefined}
                />
                <FieldError id="server-name-error" message={fieldErrors.name} />
              </div>

              <div>
                <label htmlFor="host" className="block text-sm font-medium mb-2">
                  Host
                </label>
                <input
                  id="host"
                  name="host"
                  type="text"
                  required
                  value={formData.host}
                  onChange={handleChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="example.com or 192.168.1.1"
                  aria-invalid={errorFor("host") ? true : undefined}
                  aria-describedby={errorFor("host") ? "server-host-error" : undefined}
                />
                <FieldError id="server-host-error" message={errorFor("host")} />
              </div>

              <div>
                <label htmlFor="port" className="block text-sm font-medium mb-2">
                  Port
                </label>
                <input
                  id="port"
                  name="port"
                  type="number"
                  required
                  value={formData.port}
                  onChange={handleChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="22"
                  min="1"
                  max="65535"
                  aria-invalid={errorFor("port") ? true : undefined}
                  aria-describedby={errorFor("port") ? "server-port-error" : undefined}
                />
                <FieldError id="server-port-error" message={errorFor("port")} />
              </div>

              <div>
                <label htmlFor="username" className="block text-sm font-medium mb-2">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={formData.username}
                  onChange={handleChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="root"
                  aria-invalid={errorFor("username") ? true : undefined}
                  aria-describedby={errorFor("username") ? "server-username-error" : undefined}
                />
                <FieldError id="server-username-error" message={errorFor("username")} />
              </div>

              <SSHKeyBootstrap
                selectedKeyId={
                  authType === "key" ? formData.sshKeyId || undefined : undefined
                }
                suggestedName={formData.name || formData.host}
                onKeyGenerated={(key) => {
                  setAuthType("key")
                  setFormData((prev) => ({
                    ...prev,
                    privateKey: "",
                    systemKeyPath: "",
                    sshKeyId: key.id,
                  }))
                  clearTestState()
                }}
              />

              <div>
                <label htmlFor="authType" className="block text-sm font-medium mb-2">
                  Authentication Type
                </label>
                <select
                  id="authType"
                  name="authType"
                  value={authType}
                  onChange={handleAuthTypeChange}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="password">Password</option>
                  <option value="key">SSH Key</option>
                </select>
              </div>

              {authType === 'password' ? (
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-2">
                    Password
                  </label>
                  <PasswordInput
                    id="password"
                    name="password"
                    required={authType === 'password' && !server.hasPassword}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder={server.hasPassword ? "Leave blank to keep existing" : "Enter password"}
                    autoComplete="new-password"
                    aria-invalid={errorFor("password") ? true : undefined}
                    aria-describedby={errorFor("password") ? "server-password-error" : undefined}
                  />
                  <FieldError id="server-password-error" message={errorFor("password")} />
                  <p className="text-sm text-muted-foreground mt-1">
                    {server.hasPassword
                      ? "A password is stored. Leave blank to keep it, or enter a new one to replace."
                      : "Password can test a connection, but backups need an SSH key — use Create key above."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="sshKeyId" className="block text-sm font-medium mb-2">
                      Select SSH Key
                    </label>
                    <div className="flex items-center space-x-2">
                      <select
                        id="sshKeyId"
                        name="sshKeyId"
                        value={
                          formData.sshKeyId ||
                          (formData.systemKeyPath ? `system:${formData.systemKeyPath}` : "")
                        }
                        onChange={handleSshKeySelectChange}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">-- Enter key manually or select below --</option>
                        {keysLoading ? (
                          <option disabled>Loading keys...</option>
                        ) : allKeys.length === 0 ? (
                          <option disabled>No SSH keys available</option>
                        ) : (
                          <>
                            {keys.length > 0 && (
                              <optgroup label="Database Keys">
                                {keys.map((key: SshKeyOption) => (
                                  <option key={key.id} value={key.id}>
                                    [DB] {key.name} {key.privateKeyPath ? `(${key.privateKeyPath})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {allKeys.filter(k => k.isSystemKey).length > 0 && (
                              <optgroup label="System Keys">
                                {allKeys.filter(k => k.isSystemKey).map((key: SshKeyOption) => (
                                  <option key={key.id} value={key.id}>
                                    [System] {key.name} ({key.privateKeyPath})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        )}
                      </select>
                      <Link
                        href="/settings?tab=ssh-keys"
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 py-2"
                      >
                        <KeyIcon className="h-4 w-4 mr-2" />
                        Manage
                      </Link>
                    </div>
                  </div>

                  {!formData.sshKeyId && !formData.systemKeyPath && (
                    <div>
                      <label htmlFor="privateKey" className="block text-sm font-medium mb-2">
                        Private Key
                      </label>
                      <textarea
                        id="privateKey"
                        name="privateKey"
                        value={formData.privateKey}
                        onChange={handleChange}
                        rows={8}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder={
                          server.hasPrivateKey
                            ? "Leave blank to keep existing key"
                            : "Paste your private key here"
                        }
                        aria-invalid={errorFor("privateKey") ? true : undefined}
                        aria-describedby={errorFor("privateKey") ? "server-private-key-error" : undefined}
                      />
                      <FieldError id="server-private-key-error" message={errorFor("privateKey")} />
                      {server.hasPrivateKey && (
                        <p className="text-sm text-muted-foreground mt-1">
                          A private key is stored. Leave blank to keep it, or paste a new key to replace.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="space-y-2">
              <div className="flex space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={testingBackup || loading}
                  onClick={handleTestServer}
                >
                  {testingBackup ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Testing connection...
                    </>
                  ) : (
                    <>Test connection</>
                  )}
                </Button>
              </div>

              {testError ? (
                <p className="text-sm text-destructive" role="alert">
                  {testError}
                </p>
              ) : null}

              {testResult ? (
                <ConnectionTestResultPanel
                  result={testResult}
                  showMessage={!testResult.success}
                  details={
                    testResult.success ? (
                      <ServerTransportDetails result={testResult} />
                    ) : null
                  }
                  warning={
                    authType === "password" ? (
                      <PasswordAuthWarning editHref={`/servers/${serverId}/edit`} />
                    ) : null
                  }
                />
              ) : null}
            </div>

            <div className="flex justify-end space-x-2">
              <Link
                href={`/servers/${serverId}`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                {loading ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </button>
            </div>
          </form>
        ) : null}
      </DataState>
    </ResourceEditLayout>
  )
}
