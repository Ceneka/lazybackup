"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useSettings } from "@/lib/hooks/useSettings"
import { SSHKey, SystemSSHKey, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { KeyIcon, PlusIcon, SettingsIcon, TrashIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function SettingsPage() {
  const [tab, setTab] = useState<string>("general")
  const settingsQuery = useSettings()
  const keysQuery = useSSHKeys()

  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyContent, setNewKeyContent] = useState("")

  // Local state for settings to avoid cursor jumping
  const [localDefaultSshKeyPath, setLocalDefaultSshKeyPath] = useState("")
  const [localSshKeepAliveInterval, setLocalSshKeepAliveInterval] = useState("")

  // Sync local state with settings data
  useEffect(() => {
    if (settingsQuery.settings) {
      setLocalDefaultSshKeyPath(settingsQuery.settings.defaultSshKeyPath || "")
      setLocalSshKeepAliveInterval(settingsQuery.settings.sshKeepAliveInterval || "60")
    }
  }, [settingsQuery.settings])

  // Handlers for saving settings
  const handleSaveDefaultSshKeyPath = (value: string) => {
    settingsQuery.updateSetting.mutate({ key: "defaultSshKeyPath", value })
  }

  const handleSaveSshKeepAliveInterval = (value: string) => {
    settingsQuery.updateSetting.mutate({ key: "sshKeepAliveInterval", value })
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
    if (confirm("Are you sure you want to delete this SSH key?")) {
      await keysQuery.deleteKey.mutateAsync(id)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <Tabs defaultValue="general" value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="general" className="flex items-center">
            <SettingsIcon className="mr-2 h-4 w-4" />
            General Settings
          </TabsTrigger>
          <TabsTrigger value="ssh-keys" className="flex items-center">
            <KeyIcon className="mr-2 h-4 w-4" />
            SSH Keys
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
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
        </TabsContent>

        <TabsContent value="ssh-keys" className="mt-6">
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
                        <div key={key.id} className="flex items-center justify-between border p-3 rounded-md">
                          <div>
                            <p className="font-medium">{key.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {key.privateKeyPath ? `Path: ${key.privateKeyPath}` : 'Stored in database'}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteKey(key.id)}
                          >
                            <TrashIcon className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
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
    </div>
  )
} 
