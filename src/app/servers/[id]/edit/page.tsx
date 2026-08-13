"use client"

import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { Button } from '@/components/ui/button'
import { useTestServer } from '@/lib/hooks/useServers'
import { SSHKey, getSystemKeyPathFromId, isSystemKeyId, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyIcon, Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function EditServerPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const { keys, allKeys, isLoading: keysLoading } = useSSHKeys(true) // Include system keys

  const [testingBackup, setTestingBackup] = useState(false)

  const serverTestQuery = useTestServer(serverId)

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

  // Fetch server data with useQuery
  const { data: server, isLoading: fetchLoading } = useQuery({
    queryKey: ['server', serverId],
    queryFn: async () => {
      const response = await fetch(`/api/servers/${serverId}`)

      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Server not found", {
            description: "The server you're trying to edit doesn't exist or has been deleted.",
          })
          router.push("/servers")
          return null
        }
        throw new Error("Failed to fetch server")
      }

      return response.json()
    }
  })

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'port' ? parseInt(value) || 22 : value
    }))
  }

  const handleAuthTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAuthType(e.target.value as 'password' | 'key')
  }

  // When SSH key selection changes, sync derived key fields (system path vs DB id).
  // Only update when values actually change — avoid setState loops that freeze Next.js Link.
  useEffect(() => {
    if (!formData.sshKeyId) return

    if (isSystemKeyId(formData.sshKeyId)) {
      const systemPath = getSystemKeyPathFromId(formData.sshKeyId)
      setFormData((prev) => {
        if (
          prev.sshKeyId === "" &&
          prev.systemKeyPath === systemPath &&
          prev.privateKey === ""
        ) {
          return prev
        }
        return {
          ...prev,
          privateKey: "",
          sshKeyId: "",
          systemKeyPath: systemPath,
        }
      })
      return
    }

    setFormData((prev) => {
      if (prev.privateKey === "" && prev.systemKeyPath === "" && prev.sshKeyId === formData.sshKeyId) {
        return prev
      }
      return {
        ...prev,
        privateKey: "",
        systemKeyPath: "",
        sshKeyId: formData.sshKeyId,
      }
    })
  }, [formData.sshKeyId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

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

      const response = await fetch(`/api/servers/${serverId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update server')
      }

      queryClient.invalidateQueries({ queryKey: ['servers'] })

      toast.success('Server updated successfully')
      router.push(`/servers/${serverId}`)
    } catch (error) {
      console.error('Error updating server:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update server')
    } finally {
      setLoading(false)
    }
  }

  const handleTestServer = async () => {
    try {
      setTestingBackup(true)
      const { data, isError, error } = await serverTestQuery.refetch()

      if (isError) {
        toast.error(error instanceof Error ? error.message : "Unknown error occurred")
        return
      }
      if (!data) return

      if (data.success) {
        if (data.rsyncAvailable) {
          toast.success("Backups will use rsync on the remote (preferred).")
        } else if (data.scpAvailable) {
          toast.info("No rsync on remote — backups will fall back to local SCP.")
        } else {
          toast.error("No rsync on remote and no local scp — backups cannot run.")
        }
      } else {
        toast.error(`Connection failed: ${data.message || "Failed to connect to server"}`)
      }
    } finally {
      setTestingBackup(false)
    }
  }

  if (fetchLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!server) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <h3 className="text-lg font-medium">Server not found</h3>
        <p className="text-muted-foreground mt-2 mb-4">The server you're trying to edit doesn't exist or has been deleted.</p>
        <Link
          href="/servers"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Back to Servers
        </Link>
      </div>
    )
  }

  return (
    <ResourceEditLayout
      backHref={`/servers/${serverId}`}
      backLabel="Back to server details"
      title="Edit Server"
    >
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
                />
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
                />
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
                />
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
                />
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
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required={authType === 'password' && !server?.hasPassword}
                    value={formData.password}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={server?.hasPassword ? "Leave blank to keep existing" : "Enter password"}
                    autoComplete="new-password"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    {server?.hasPassword
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
                        onChange={handleChange}
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
                                {keys.map((key: SSHKey) => (
                                  <option key={key.id} value={key.id}>
                                    [DB] {key.name} {key.privateKeyPath ? `(${key.privateKeyPath})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {allKeys.filter(k => k.isSystemKey).length > 0 && (
                              <optgroup label="System Keys">
                                {allKeys.filter(k => k.isSystemKey).map((key: SSHKey) => (
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
                          server?.hasPrivateKey
                            ? "Leave blank to keep existing key"
                            : "Paste your private key here"
                        }
                      />
                      {server?.hasPrivateKey && (
                        <p className="text-sm text-muted-foreground mt-1">
                          A private key is stored. Leave blank to keep it, or paste a new key to replace.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

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
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
    </ResourceEditLayout>
  )
} 
