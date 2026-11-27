"use client"

import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import {
  ConnectionTestResultPanel,
  ServerTransportDetails,
} from "@/components/connections/connection-test-result"
import { FieldError, PasswordInput } from "@/components/connections/form-controls"
import { PasswordAuthWarning } from "@/components/connections/server-auth"
import { Button } from "@/components/ui/button"
import { ApiError, readApiError } from "@/lib/api/client-error"
import { getSystemKeyPathFromId, isSystemKeyId, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { useTestNewServerBackupCapabilities } from "@/lib/hooks/useServers"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, KeyIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

type SshKeyOption = {
  id: string
  name: string
  privateKeyPath?: string | null
  isSystemKey?: boolean
}

export default function NewServerPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [authType, setAuthType] = useState<'password' | 'key'>('key')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [testError, setTestError] = useState<string | null>(null)
  const [testFieldErrors, setTestFieldErrors] = useState<Record<string, string>>({})
  const { keys, allKeys, isLoading: keysLoading } = useSSHKeys(true) // Include system keys
  const {
    testServer,
    isLoading: testingBackup,
    result: testResult,
    resetResult,
  } = useTestNewServerBackupCapabilities()

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'port' ? parseInt(value) || 22 : value
    }))
    clearTestState()
  }

  const handleAuthTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAuthType(e.target.value as 'password' | 'key')
    clearTestState()
  }

  function clearTestState() {
    resetResult()
    setTestError(null)
    setTestFieldErrors({})
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setFormError(null)
    setFieldErrors({})

    try {
      const payload = {
        ...formData,
        authType,
        // Only include authentication data based on authType and selected key type
        password: authType === 'password' ? formData.password : undefined,
        privateKey: authType === 'key' && !formData.sshKeyId && !formData.systemKeyPath ? formData.privateKey : undefined,
        sshKeyId: authType === 'key' && formData.sshKeyId ? formData.sshKeyId : undefined,
        systemKeyPath: authType === 'key' && formData.systemKeyPath ? formData.systemKeyPath : undefined,
      }

      const response = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        setFormError(message)
        setFieldErrors(fieldErrors)
        return
      }

      // Invalidate servers query cache
      queryClient.invalidateQueries({ queryKey: ['servers'] })

      toast.success('Server added successfully')
      router.push('/connections?tab=servers')
    } catch (error) {
      console.error('Error adding server:', error)
      const message = error instanceof Error ? error.message : 'Failed to add server'
      setFormError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  // Add a new function to test backup capabilities
  const handleTestBackupCapabilities = async () => {
    clearTestState()

    const nextErrors: Record<string, string> = {}
    if (!formData.host.trim()) nextErrors.host = "Host is required"
    if (!formData.username.trim()) nextErrors.username = "Username is required"
    if (!formData.port || formData.port < 1 || formData.port > 65535) {
      nextErrors.port = "Port must be between 1 and 65535"
    }
    if (authType === 'password' && !formData.password.trim()) {
      nextErrors.password = "Password is required to test"
    }
    if (
      authType === 'key' &&
      !formData.sshKeyId &&
      !formData.systemKeyPath &&
      !formData.privateKey.trim()
    ) {
      nextErrors.privateKey = "Select or paste an SSH key to test"
    }

    if (Object.keys(nextErrors).length > 0) {
      setTestFieldErrors(nextErrors)
      setTestError("Fix the highlighted fields to test the connection.")
      return
    }

    try {
      // Prepare server data from form
      const serverData = {
        ...formData,
        authType,
        // Only include authentication data based on authType and selected key type
        password: authType === 'password' ? formData.password : undefined,
        privateKey: authType === 'key' && !formData.sshKeyId && !formData.systemKeyPath ? formData.privateKey : undefined,
        sshKeyId: authType === 'key' && formData.sshKeyId ? formData.sshKeyId : undefined,
        systemKeyPath: authType === 'key' && formData.systemKeyPath ? formData.systemKeyPath : undefined,
      }

      // Run the test — the hook keeps the inline result (success or failure).
      await testServer(serverData)
    } catch (error) {
      if (error instanceof ApiError) setTestFieldErrors(error.fieldErrors)
    }
  }

  const errorFor = (name: string) =>
    testFieldErrors[name] ?? fieldErrors[name]

  return (
    <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <Link href="/connections?tab=servers" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to servers</span>
          </Link>
          <h1 className="text-3xl font-bold">Add server</h1>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow">
          <div className="p-6">
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
                    <option value="key">SSH Key</option>
                    <option value="password">Password</option>
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
                      required={authType === 'password'}
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Enter password"
                      autoComplete="new-password"
                      aria-invalid={errorFor("password") ? true : undefined}
                      aria-describedby={errorFor("password") ? "server-password-error" : undefined}
                    />
                    <FieldError id="server-password-error" message={errorFor("password")} />
                    <p className="text-sm text-muted-foreground mt-1">
                      Password can test a connection, but backups need an SSH key — use Create key above.
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
                          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <KeyIcon className="mr-2 h-4 w-4" />
                          Manage
                        </Link>
                      </div>

                      {formData.systemKeyPath && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Using system key: {formData.systemKeyPath}
                        </p>
                      )}

                      {!keysLoading && allKeys.length === 0 && (
                        <p className="text-sm text-muted-foreground mt-1">
                          No SSH keys found. Create one above, add keys in Settings, or paste a private key below.
                        </p>
                      )}
                    </div>

                    {!formData.sshKeyId && !formData.systemKeyPath && (
                      <div>
                        <label htmlFor="privateKey" className="block text-sm font-medium mb-2">
                          Private Key
                        </label>
                        <textarea
                          id="privateKey"
                          name="privateKey"
                          required={authType === 'key' && !formData.sshKeyId && !formData.systemKeyPath}
                          value={formData.privateKey}
                          onChange={handleChange}
                          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="Paste your private key here"
                          aria-invalid={errorFor("privateKey") ? true : undefined}
                          aria-describedby={errorFor("privateKey") ? "server-private-key-error" : undefined}
                        />
                        <FieldError id="server-private-key-error" message={errorFor("privateKey")} />
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

              {/* Test connection after the form fields, before the submit button */}
              <div className="space-y-2">
                <div className="flex space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testingBackup || loading}
                    onClick={handleTestBackupCapabilities}
                  >
                    {testingBackup ? (
                      <>
                        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                        Testing…
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
                        <PasswordAuthWarning />
                      ) : null
                    }
                  />
                ) : null}
              </div>

              <div className="flex justify-end space-x-4">
                <Button type="button" variant="outline" onClick={() => router.push('/connections?tab=servers')}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add server'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
    </div>
  )
} 
