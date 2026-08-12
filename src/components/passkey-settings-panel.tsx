"use client"

import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { startRegistration } from "@simplewebauthn/browser"
import { KeyRoundIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { authStatusKey } from "@/lib/hooks/useAuth"

type PasskeyRow = {
  id: string
  name: string
  credentialId: string
  createdAt: string
  lastUsedAt: string | null
}

export function PasskeySettingsPanel() {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")

  const listQuery = useQuery({
    queryKey: ["passkeys"],
    queryFn: async (): Promise<PasskeyRow[]> => {
      const res = await fetch("/api/auth/webauthn/credentials")
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to load passkeys")
      }
      const data = await res.json()
      return data.passkeys
    },
  })

  const register = useMutation({
    mutationFn: async () => {
      const optRes = await fetch("/api/auth/webauthn/register")
      if (!optRes.ok) {
        const err = await optRes.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to start registration")
      }
      const options = await optRes.json()
      const response = await startRegistration({ optionsJSON: options })
      const verifyRes = await fetch("/api/auth/webauthn/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, name: name.trim() || undefined }),
      })
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Registration failed")
      }
      return verifyRes.json()
    },
    onSuccess: () => {
      setName("")
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] })
      void queryClient.invalidateQueries({ queryKey: authStatusKey })
      toast.success("Passkey registered")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/auth/webauthn/credentials?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to remove passkey")
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] })
      void queryClient.invalidateQueries({ queryKey: authStatusKey })
      toast.success("Passkey removed")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="h-5 w-5" />
          Passkeys
        </CardTitle>
        <CardDescription>
          Sign in with a device passkey (Touch ID, Windows Hello, security key).
          Works alongside or instead of the app password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(listQuery.data?.length ?? 0) > 0 && (
          <ul className="space-y-2">
            {listQuery.data!.map((pk) => (
              <li
                key={pk.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div>
                  <div className="font-medium">{pk.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Added {new Date(pk.createdAt).toLocaleString()}
                    {pk.lastUsedAt
                      ? ` · last used ${new Date(pk.lastUsedAt).toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (!confirm("Remove this passkey?")) return
                    remove.mutate(pk.id)
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 max-w-md">
          <Label htmlFor="passkey-name">Name (optional)</Label>
          <Input
            id="passkey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Laptop"
          />
          <LoadingButton
            type="button"
            isLoading={register.isPending}
            onClick={() => register.mutate()}
          >
            Register passkey
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  )
}
