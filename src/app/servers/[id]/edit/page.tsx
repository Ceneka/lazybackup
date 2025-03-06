"use client"

import { SSHKey, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, KeyIcon, Loader2Icon } from "lucide-react"
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
  const { keys, allKeys, isSystemKey, getSystemKeyPath, isLoading: keysLoading } = useSSHKeys(true) // Include system keys
  
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
          toast.error("Server not found")
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
        password: server.password || '',
        privateKey: server.privateKey || '',
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
  
  // When SSH key selection changes, clear the privateKey field and set the appropriate key data
  useEffect(() => {
    if (formData.sshKeyId) {
      // Check if this is a system key
      if (isSystemKey(formData.sshKeyId)) {
        const systemPath = getSystemKeyPath(formData.sshKeyId);
        setFormData(prev => ({
          ...prev,
          privateKey: '',
          sshKeyId: '', // Clear database key ID
          systemKeyPath: systemPath
        }))
      } else {
        // This is a database key
        setFormData(prev => ({
          ...prev,
          privateKey: '',
          systemKeyPath: '', // Clear system key path
          sshKeyId: formData.sshKeyId
        }))
      }
    }
  }, [formData.sshKeyId, isSystemKey, getSystemKeyPath])

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

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update server')
      }

      // Invalidate server queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['server', serverId] })
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
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Link href={`/servers/${serverId}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to server details</span>
        </Link>
        <h1 className="text-3xl font-bold">Edit Server</h1>
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
                    required={authType === 'password'}
                    value={formData.password}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Enter password"
                  />
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
                        value={formData.sshKeyId}
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
                        href="/settings/ssh-keys"
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
                        placeholder="Paste your private key here"
                      />
                    </div>
                  )}
                </div>
              )}
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
        </div>
      </div>
    </div>
  )
} 
