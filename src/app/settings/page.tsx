"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useSettings } from "@/lib/hooks/useSettings"
import { SSHKey, SystemSSHKey, useSSHKeys } from "@/lib/hooks/useSSHKeys"
import { KeyIcon, Loader2Icon, PlusIcon, SettingsIcon, TrashIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

export default function SettingsPage() {
  const [tab, setTab] = useState<string>("general")
  const { settings, updateSetting, isLoading: settingsLoading } = useSettings()
  const { keys, systemKeys, addKey, deleteKey, isLoading: keysLoading } = useSSHKeys()
  
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyContent, setNewKeyContent] = useState("")
  
  const handleAddKey = async () => {
    if (!newKeyName) {
      toast.error("Key name is required")
      return
    }
    
    try {
      await addKey.mutateAsync({
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
      await deleteKey.mutateAsync(id)
    }
  }
  
  const handleAddSystemKey = async (systemKey: {name: string, privateKeyPath: string}) => {
    try {
      await addKey.mutateAsync({
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
              {settingsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="defaultSshKeyPath">Default SSH Key Path</Label>
                      <Input
                        id="defaultSshKeyPath"
                        value={settings.defaultSshKeyPath || ""}
                        onChange={(e) => updateSetting.mutate({ key: "defaultSshKeyPath", value: e.target.value })}
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
                        value={settings.sshKeepAliveInterval || "60"}
                        onChange={(e) => updateSetting.mutate({ key: "sshKeepAliveInterval", value: e.target.value })}
                        placeholder="60"
                        className="mt-1"
                      />
                      <p className="text-sm text-muted-foreground mt-1">
                        Send a keep-alive packet at this interval to prevent connection timeout
                      </p>
                    </div>
                  </div>
                </>
              )}
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
                {keysLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : keys.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No SSH keys stored in the database
                  </div>
                ) : (
                  <div className="space-y-4">
                    {keys.map((key: SSHKey) => (
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
                <Button 
                  className="w-full" 
                  onClick={handleAddKey}
                  disabled={addKey.isPending || !newKeyName}
                >
                  {addKey.isPending ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Add SSH Key
                    </>
                  )}
                </Button>
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
                {keysLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : systemKeys.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No SSH keys found on your system
                  </div>
                ) : (
                  <div className="space-y-4">
                    {systemKeys.map((key: SystemSSHKey) => (
                      <div key={key.privateKeyPath} className="flex items-center justify-between border p-3 rounded-md">
                        <div>
                          <p className="font-medium">{key.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Path: {key.privateKeyPath}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddSystemKey(key)}
                          disabled={addKey.isPending}
                        >
                          <PlusIcon className="mr-2 h-4 w-4" />
                          Add to Library
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
} 
