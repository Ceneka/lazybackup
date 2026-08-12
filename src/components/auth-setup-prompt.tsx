"use client"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { useAuth } from "@/lib/hooks/useAuth"
import { useState } from "react"
import { toast } from "sonner"

export function AuthSetupPrompt() {
  const auth = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")

  const open =
    Boolean(auth.data) &&
    !auth.data!.authSetupCompleted &&
    !auth.data!.authEnabled

  const handleSkip = async () => {
    try {
      await auth.setup.mutateAsync({ skip: true })
      toast.success("Skipped — you can enable a password later in Settings")
    } catch {
      // toast in hook
    }
  }

  const handleSetPassword = async () => {
    if (password !== confirm) {
      toast.error("Passwords do not match")
      return
    }
    try {
      await auth.setup.mutateAsync({ password })
      toast.success("Password set — the app is now protected")
      setPassword("")
      setConfirm("")
    } catch {
      // toast in hook
    }
  }

  if (auth.isLoading || !open) {
    return null
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Protect LazyBackup?</AlertDialogTitle>
          <AlertDialogDescription>
            Optionally set a password to lock the dashboard and APIs. You can
            skip now and enable this later in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="setup-password">Password</Label>
            <Input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-confirm">Confirm password</Label>
            <Input
              id="setup-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>

        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <LoadingButton
            type="button"
            variant="outline"
            isLoading={
              auth.setup.isPending &&
              !!auth.setup.variables &&
              "skip" in auth.setup.variables
            }
            loadingText="Skipping…"
            disabled={auth.setup.isPending}
            onClick={() => void handleSkip()}
          >
            Skip
          </LoadingButton>
          <LoadingButton
            type="button"
            isLoading={
              auth.setup.isPending &&
              auth.setup.variables !== undefined &&
              "password" in auth.setup.variables
            }
            loadingText="Saving…"
            disabled={!password || !confirm || auth.setup.isPending}
            onClick={() => void handleSetPassword()}
          >
            Set password
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
